<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">IRL events</h2>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        Club invitations and check-in tokens for in-person events.
      </p>
    </div>

    <div v-if="message" class="rounded-lg border px-4 py-3 text-sm" :class="messageClass">
      {{ message }}
    </div>

    <section class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <h3 class="font-semibold text-gray-900 dark:text-white">
        {{ editingId ? 'Edit event' : 'New event' }}
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="text-xs text-gray-600 dark:text-gray-300 block"
          >Title
          <input
            v-model="form.title"
            type="text"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block"
          >Location
          <input
            v-model="form.location"
            type="text"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block"
          >Starts at (ISO)
          <input
            v-model="form.startsAt"
            type="text"
            placeholder="2026-10-01T18:00:00Z"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block"
          >Ends at (optional ISO)
          <input
            v-model="form.endsAt"
            type="text"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <label class="text-xs text-gray-600 dark:text-gray-300 block"
          >Capacity (blank = unlimited)
          <input
            v-model="form.capacity"
            type="number"
            min="1"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <div class="flex flex-wrap items-end gap-4 pb-1">
          <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input
              v-model="form.clubOnly"
              type="checkbox"
              class="rounded border-gray-300 dark:border-gray-600"
            >
            Club only
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input
              v-model="form.published"
              type="checkbox"
              class="rounded border-gray-300 dark:border-gray-600"
            >
            Published
          </label>
        </div>
      </div>
      <label class="text-xs text-gray-600 dark:text-gray-300 block"
        >Description
        <textarea
          v-model="form.description"
          rows="3"
          class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        />
      </label>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
          :disabled="saving"
          @click="saveEvent"
        >
          {{ saving ? 'Saving…' : editingId ? 'Update event' : 'Create event' }}
        </button>
        <button
          v-if="editingId"
          type="button"
          class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
          @click="resetForm"
        >
          Cancel edit
        </button>
      </div>
    </section>

    <section class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <h3 class="font-semibold text-gray-900 dark:text-white">Check in</h3>
      <div class="flex flex-wrap gap-2 items-end">
        <label class="text-xs text-gray-600 dark:text-gray-300 block flex-1 min-w-[12rem]"
          >Check-in token
          <input
            v-model="checkInToken"
            type="text"
            class="mt-1 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          >
        </label>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
          :disabled="checkingIn"
          @click="runCheckIn"
        >
          {{ checkingIn ? 'Checking in…' : 'Check in' }}
        </button>
      </div>
      <p v-if="checkInResult" class="text-sm text-gray-700 dark:text-gray-300">
        {{ checkInResult }}
      </p>
    </section>

    <div v-if="loading" class="text-sm text-gray-600 dark:text-gray-400">Loading events…</div>
    <div v-else class="space-y-3">
      <div
        v-for="event in events"
        :key="event.id"
        class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-gray-900 dark:text-white">{{ event.title }}</p>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatWhen(event.startsAt) }}
              <span v-if="event.location"> · {{ event.location }}</span>
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              RSVPs {{ event.rsvpCount }}{{ event.capacity != null ? ` / ${event.capacity}` : '' }}
              · {{ event.clubOnly ? 'Club only' : 'Open' }}
              · {{ event.published ? 'Published' : 'Draft' }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
              @click="startEdit(event)"
            >
              Edit
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-sm text-red-700 dark:text-red-300 bg-white dark:bg-gray-900 hover:bg-red-50 dark:hover:bg-red-950/40"
              @click="deleteEvent(event.id)"
            >
              Delete
            </button>
          </div>
        </div>
        <p
          v-if="event.description"
          class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap"
        >
          {{ event.description }}
        </p>
      </div>
      <p v-if="!events.length" class="text-sm text-gray-500 dark:text-gray-400">
        No IRL events yet.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
  type IrlEvent = {
    id: string;
    title: string;
    description: string;
    location: string;
    startsAt: string;
    endsAt: string | null;
    capacity: number | null;
    clubOnly: boolean;
    published: boolean;
    rsvpCount: number;
  };

  const config = useRuntimeConfig();
  const { authHeader } = useAuth();

  const events = ref<IrlEvent[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const checkingIn = ref(false);
  const message = ref('');
  const messageClass = ref('');
  const editingId = ref<string | null>(null);
  const checkInToken = ref('');
  const checkInResult = ref('');

  const emptyForm = () => ({
    title: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    capacity: '' as string | number,
    clubOnly: true,
    published: false,
  });
  const form = ref(emptyForm());

  function flash(text: string, ok: boolean) {
    message.value = text;
    messageClass.value = ok
      ? 'border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:border-green-700 dark:text-green-200'
      : 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-200';
  }

  function formatWhen(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function resetForm() {
    editingId.value = null;
    form.value = emptyForm();
  }

  function startEdit(event: IrlEvent) {
    editingId.value = event.id;
    form.value = {
      title: event.title,
      description: event.description,
      location: event.location,
      startsAt: event.startsAt,
      endsAt: event.endsAt || '',
      capacity: event.capacity ?? '',
      clubOnly: event.clubOnly,
      published: event.published,
    };
  }

  async function loadEvents() {
    loading.value = true;
    try {
      const res = await fetch(`${config.public.apiUrl}/api/admin/irl-events`, {
        headers: { ...authHeader() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      events.value = Array.isArray(data.events) ? data.events : [];
    } catch (e: any) {
      flash(e.message || 'Failed to load events', false);
    } finally {
      loading.value = false;
    }
  }

  function payloadFromForm() {
    const capacityRaw = form.value.capacity;
    const capacity =
      capacityRaw === '' || capacityRaw === null || capacityRaw === undefined
        ? null
        : Number(capacityRaw);
    return {
      title: form.value.title,
      description: form.value.description,
      location: form.value.location,
      startsAt: form.value.startsAt,
      endsAt: form.value.endsAt || null,
      capacity,
      clubOnly: form.value.clubOnly,
      published: form.value.published,
    };
  }

  async function saveEvent() {
    saving.value = true;
    try {
      const editing = editingId.value;
      const res = await fetch(
        editing
          ? `${config.public.apiUrl}/api/admin/irl-events/${editing}`
          : `${config.public.apiUrl}/api/admin/irl-events`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify(payloadFromForm()),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      flash(editing ? 'Event updated.' : 'Event created.', true);
      resetForm();
      await loadEvents();
    } catch (e: any) {
      flash(e.message || 'Failed to save event', false);
    } finally {
      saving.value = false;
    }
  }

  async function deleteEvent(id: string) {
    if (!confirm('Delete this IRL event and its RSVPs?')) return;
    try {
      const res = await fetch(`${config.public.apiUrl}/api/admin/irl-events/${id}`, {
        method: 'DELETE',
        headers: { ...authHeader() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      flash('Event deleted.', true);
      if (editingId.value === id) resetForm();
      await loadEvents();
    } catch (e: any) {
      flash(e.message || 'Failed to delete event', false);
    }
  }

  async function runCheckIn() {
    checkingIn.value = true;
    checkInResult.value = '';
    try {
      const res = await fetch(`${config.public.apiUrl}/api/admin/irl-events/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ checkInToken: checkInToken.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const email = data.rsvp?.userEmail || data.rsvp?.userId || 'guest';
      const title = data.rsvp?.eventTitle || 'event';
      checkInResult.value = data.alreadyCheckedIn
        ? `Already checked in: ${email} · ${title}`
        : `Checked in: ${email} · ${title}`;
      flash('Check-in recorded.', true);
      checkInToken.value = '';
    } catch (e: any) {
      flash(e.message || 'Check-in failed', false);
    } finally {
      checkingIn.value = false;
    }
  }

  onMounted(() => {
    void loadEvents();
  });
</script>
