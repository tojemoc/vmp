/**
 * E-invoice transmission stubs (Peppol Access Point + ISDOC delivery).
 *
 * Real Peppol AP HTTP integration is gated on Worker secret `PEPPOL_AP_API_KEY`
 * plus admin settings (`peppol_access_point_api_url`, sender id). Until a
 * provider is contracted, `einvoicing_delivery_mode=stub` records a dry-run
 * transmission id with status `stub_sent` so operators can exercise the queued →
 * delivered path without claiming live Peppol delivery.
 *
 * ISDOC B2B delivery in CZ is consent/email-based (no central network). The
 * stub marks XML as ready-for-email; live SMTP attachment send is deferred.
 */

import { getSetting } from './settingsStore.js';

export type DeliveryOutcome =
  | {
      ok: true;
      mode: 'stub' | 'live';
      status: 'sent' | 'stub_sent';
      transmissionId: string;
      messageId?: string | null;
      detail: string;
    }
  | {
      ok: false;
      mode: 'stub' | 'live';
      status: 'queued' | 'failed';
      code: string;
      detail: string;
    };

export interface PeppolTransmitInput {
  invoiceId: string;
  invoiceNumber: string;
  xml: string;
  sellerParticipantId: string;
  sellerSchemeId: string;
  buyerEndpointId: string;
  buyerSchemeId: string;
}

export interface IsdocDeliverInput {
  invoiceId: string;
  invoiceNumber: string;
  xml: string;
  buyerEmail: string | null;
  buyerName: string | null;
}

function deliveryModeFromSetting(raw: string | null | undefined): 'stub' | 'live' {
  return String(raw ?? 'stub')
    .trim()
    .toLowerCase() === 'live'
    ? 'live'
    : 'stub';
}

/**
 * Peppol BIS Billing 3.0 send stub. Live mode POSTs UBL to the configured AP
 * URL when `PEPPOL_AP_API_KEY` is present; otherwise returns not_configured.
 */
export async function transmitPeppolUbl(
  env: any,
  input: PeppolTransmitInput,
): Promise<DeliveryOutcome> {
  const mode = deliveryModeFromSetting(
    await getSetting(env, 'einvoicing_delivery_mode', { defaultValue: 'stub' }),
  );
  const apiUrl = String(
    (await getSetting(env, 'peppol_access_point_api_url', { defaultValue: '' })) ?? '',
  ).trim();
  const senderId = String(
    (await getSetting(env, 'peppol_access_point_sender_id', { defaultValue: '' })) ?? '',
  ).trim();
  const provider = String(
    (await getSetting(env, 'peppol_access_point_provider', { defaultValue: '' })) ?? '',
  ).trim();
  const apiKey = String(env?.PEPPOL_AP_API_KEY ?? '').trim();

  if (mode === 'stub') {
    const transmissionId = `stub:peppol:${input.invoiceId}`;
    return {
      ok: true,
      mode: 'stub',
      status: 'stub_sent',
      transmissionId,
      messageId: `stub-msg:${input.invoiceNumber}`,
      detail: `Dry-run Peppol transmission (${provider || 'unconfigured provider'}); no Access Point call made.`,
    };
  }

  if (!apiKey || !apiUrl) {
    return {
      ok: false,
      mode: 'live',
      status: 'queued',
      code: 'peppol_ap_not_configured',
      detail:
        'Live Peppol delivery requires PEPPOL_AP_API_KEY (Worker secret) and peppol_access_point_api_url.',
    };
  }

  if (!input.sellerParticipantId || !input.buyerEndpointId) {
    return {
      ok: false,
      mode: 'live',
      status: 'failed',
      code: 'peppol_participants_missing',
      detail: 'Seller Peppol participant id and buyer endpoint id are required for live send.',
    };
  }

  // Provider-agnostic placeholder: accredited APs differ. Keep payload minimal
  // and treat non-2xx as failure so Stripe-driven retries can re-queue later.
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documentType: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        processId: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
        sender: { schemeId: input.sellerSchemeId, value: input.sellerParticipantId },
        receiver: { schemeId: input.buyerSchemeId, value: input.buyerEndpointId },
        senderId: senderId || input.sellerParticipantId,
        invoiceNumber: input.invoiceNumber,
        documentXml: input.xml,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return {
        ok: false,
        mode: 'live',
        status: 'failed',
        code: 'peppol_ap_http_error',
        detail: `Peppol AP HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const transmissionId = String(
      payload.transmissionId ?? payload.id ?? `peppol:${input.invoiceId}:${Date.now()}`,
    );
    const messageId =
      typeof payload.messageId === 'string'
        ? payload.messageId
        : typeof payload.message_id === 'string'
          ? payload.message_id
          : null;

    return {
      ok: true,
      mode: 'live',
      status: 'sent',
      transmissionId,
      messageId,
      detail: 'Submitted to Peppol Access Point.',
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'live',
      status: 'failed',
      code: 'peppol_ap_network_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * ISDOC delivery stub. Live email attachment send is deferred; stub mode marks
 * the document as sent after XML is stored in R2.
 */
export async function deliverIsdocInvoice(
  env: any,
  input: IsdocDeliverInput,
): Promise<DeliveryOutcome> {
  const mode = deliveryModeFromSetting(
    await getSetting(env, 'einvoicing_delivery_mode', { defaultValue: 'stub' }),
  );
  const method = String(
    (await getSetting(env, 'einvoicing_isdoc_delivery_method', {
      defaultValue: 'email_stub',
    })) ?? 'email_stub',
  )
    .trim()
    .toLowerCase();

  if (mode === 'stub' || method === 'email_stub') {
    return {
      ok: true,
      mode: 'stub',
      status: 'stub_sent',
      transmissionId: `stub:isdoc:${input.invoiceId}`,
      messageId: input.buyerEmail ? `mailto:${input.buyerEmail}` : null,
      detail:
        'Dry-run ISDOC delivery — XML archived; live email/portal delivery not yet configured.',
    };
  }

  if (!input.buyerEmail) {
    return {
      ok: false,
      mode: 'live',
      status: 'failed',
      code: 'isdoc_buyer_email_missing',
      detail: 'ISDOC email delivery requires buyer email.',
    };
  }

  return {
    ok: false,
    mode: 'live',
    status: 'queued',
    code: 'isdoc_email_delivery_deferred',
    detail:
      'Live ISDOC email delivery is not implemented yet; keep invoice queued or switch delivery_mode to stub.',
  };
}
