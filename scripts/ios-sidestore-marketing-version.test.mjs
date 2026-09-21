import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sidestoreMarketingVersion,
  sidestoreWouldOfferUpdate,
} from "./ios-sidestore-marketing-version.mjs";

describe("sidestoreMarketingVersion", () => {
  it("encodes CI build into the patch component", () => {
    assert.equal(sidestoreMarketingVersion("0.1.0", 10), "0.1.10");
    assert.equal(sidestoreMarketingVersion("0.1.0", "9"), "0.1.9");
    assert.equal(sidestoreMarketingVersion("1.2.3", 42), "1.2.42");
  });

  it("rejects non-integer builds", () => {
    assert.throws(
      () => sidestoreMarketingVersion("0.1.0", "1.0"),
      /non-zero decimal integer/,
    );
    assert.throws(() => sidestoreMarketingVersion("0.1.0", ""), /non-zero decimal integer/);
  });

  it("rejects zero and leading-zero build numbers", () => {
    assert.throws(() => sidestoreMarketingVersion("0.1.0", "0"), /non-zero decimal integer/);
    assert.throws(() => sidestoreMarketingVersion("0.1.0", 0), /non-zero decimal integer/);
    assert.throws(() => sidestoreMarketingVersion("0.1.0", "01"), /non-zero decimal integer/);
    assert.throws(() => sidestoreMarketingVersion("0.1.0", "010"), /non-zero decimal integer/);
  });
});

describe("SideStore hasUpdate simulation (marketing version only)", () => {
  it("does NOT offer update when only buildVersion would change (legacy bug)", () => {
    // Historical VMP releases: version stuck at 0.1.0, build 9 → 10
    assert.equal(sidestoreWouldOfferUpdate("0.1.0", "0.1.0"), false);
  });

  it("offers update when marketing patch encodes the CI build", () => {
    assert.equal(sidestoreWouldOfferUpdate("0.1.9", "0.1.10"), true);
    assert.equal(sidestoreWouldOfferUpdate("0.1.0", "0.1.10"), true);
    assert.equal(sidestoreWouldOfferUpdate("0.1.10", "0.1.10"), false);
  });
});
