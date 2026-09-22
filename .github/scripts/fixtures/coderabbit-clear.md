<!-- This is an auto-generated comment: summarize by coderabbit.ai -->
<!-- review_stack_entry_start -->

<a href="https://app.coderabbit.ai/change-stack/tojemoc/vmp/pull/698"><img src="https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui-dark.svg?v=2" alt="Review in Change Stack →" width="220" height="32"></a>

Navigate logical layers of code changes, visualize relationships, and explore their blast radius.

<!-- review_stack_entry_end -->
<!-- recent_review_start -->

No actionable comments were generated in the recent review. 🎉

<details>
<summary>ℹ️ Recent review info</summary>

<details>
<summary>⚙️ Run configuration</summary>

**Configuration used**: Repository: tojemoc/vmp/.coderabbit.yaml

**Review profile**: CHILL

**Plan**: Advanced

**Run ID**: `53fc8f14-681f-4db4-93b8-1b4d54ee0bbe`

</details>

<details>
<summary>📥 Commits</summary>

Reviewing files that changed from the base of the PR and between b6dd03fa4b0520969a538600d58529eb077ba596 and 6e5018f699bf06d0094ae14b85101d3d7c59e911.

</details>

<details>
<summary>📒 Files selected for processing (8)</summary>

* `apps/mobile/README.md`
* `packages/api/src/auth.ts`
* `packages/web/pages/auth/verify.vue`
* `packages/web/pages/login.vue`
* `packages/web/test/native-app-handoff.test.ts`
* `packages/web/test/pwa-offline-surface.test.ts`
* `packages/web/utils/nativeAppHandoff.ts`
* `packages/web/utils/pwa.ts`

</details>

**Included review availability:** Your plan provides up to 1 included review per hour; 0 remain after this review.

</details>

---



<!-- recent_review_end -->
<!-- walkthrough_start -->

<details>
<summary>📝 Walkthrough</summary>

## Walkthrough

The PR adds PostHog analytics to magic-link requests, handoffs, and redemption outcomes. It also restricts Android intent handoff to Chromium browsers and routes Firefox for Android through web redemption.

### Changes

**Magic-link authentication flow**

|Layer / File(s)|Summary|
|---|---|
|**Android browser handoff** <br> `packages/web/utils/nativeAppHandoff.ts`, `packages/web/utils/pwa.ts`, `packages/web/test/*`, `apps/mobile/README.md`|The shared intent builder now supports browser fallback URLs. Android Chrome handoff uses `com.android.chrome`. Firefox for Android no longer receives the intent handoff. Tests cover Chrome and Firefox detection.|
|**API and login event capture** <br> `packages/api/src/auth.ts`, `packages/web/pages/login.vue`|Magic-link requests and redemption outcomes now emit PostHog events. Events include client, API surface, redemption surface, outcome, failure reason, and user identity when available.|
|**Web verification instrumentation** <br> `packages/web/pages/auth/verify.vue`|The verification page records handoff attempts, prompts, browser fallbacks, successful redeems, and failed redeems. The initial verification state now avoids client-only SSR lookahead checks.|

<!-- change_assessment_start -->
**Priority:** ⬇️ Low

**Estimated code review effort:** 3 (Moderate) | ~25 minutes

<!-- change_assessment_commit:"6e5018f699bf06d0094ae14b85101d3d7c59e911" -->
**Change:** Bug fix
<!-- change_assessment_end -->

</details>

<!-- walkthrough_end -->
<!-- final_review_risk_start -->
**Merge Risk:** _⚪ Minimal_ · up to `6e501`
<!-- final_review_risk_coverage:{"sourceCommitId":"6e5018f699bf06d0094ae14b85101d3d7c59e911","coveredCommitId":"6e5018f699bf06d0094ae14b85101d3d7c59e911","kind":"reviewed"} -->

This change adds sign-in analytics and routes Firefox for Android through web redemption. No concrete correctness, security, or availability issue remains identified, so it is mergeable with normal checks.
<!-- final_review_risk_end -->
<!-- pre_merge_checks_walkthrough_start -->

<details>
<summary>🚥 Pre-merge checks | ✅ 4 | ❌ 1</summary>

### ❌ Failed checks (1 warning)

|     Check name     | Status     | Explanation                                                                                                                                                                                               | Resolution                                                                         |
| :----------------: | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| Docstring Coverage | ⚠️ Warning | Docstring coverage is 73.33% which is insufficient. The required threshold is 80.00%. Docstring coverage is scoped to functions touched by this diff. Analyzed 15 functions across 5 files. (3 skipped: … | Write docstrings for the functions missing them to satisfy the coverage threshold. |

<details>
<summary>✅ Passed checks (4 passed)</summary>

|         Check name         | Status   | Explanation                                                                                                                   |
| :------------------------: | :------- | :---------------------------------------------------------------------------------------------------------------------------- |
|      Description Check     | ✅ Passed | Check skipped - CodeRabbit’s high-level summary is enabled.                                                                   |
|         Title check        | ✅ Passed | The title clearly summarizes the main changes: hardening Android magic-link handoff and adding sign-in event instrumentation. |
|     Linked Issues check    | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                      |
| Out of Scope Changes check | ✅ Passed | Check skipped because no linked issues were found for this pull request.                                                      |

</details>

<details>
<summary>Full details: Docstring Coverage</summary>

**Explanation**

Docstring coverage is 73.33% which is insufficient. The required threshold is 80.00%. Docstring coverage is scoped to functions touched by this diff. Analyzed 15 functions across 5 files. (3 skipped: 3 unsupported.)

</details>

</details>

<!-- pre_merge_checks_walkthrough_end -->

- [ ] <!-- {"checkboxId":"585bb3f6-faf5-4dbf-96d2-74e382adf19a"} --> Fix all pre-merge checks with AI
<!-- finishing_touch_checkbox_start -->

<details>
<summary>✨ Finishing Touches 💡 1</summary>

<!-- finishing_touch_suggestion:docstrings -->
<details open>
<summary>📝 Generate docstrings 💡</summary>

- [ ] <!-- {"checkboxId":"3e1879ae-f29b-4d0d-8e06-d12b7ba33d98"} --> Commit to this branch
- [ ] <!-- {"checkboxId":"7962f53c-55bc-4827-bfbf-6a18da830691"} --> Create a new PR

</details>
<details open>
<summary>🧪 Generate unit tests (beta)</summary>

- [ ] <!-- {"checkboxId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "radioGroupId": "utg-output-choice-group-unknown_comment_id"} --> Commit to this branch
- [ ] <!-- {"checkboxId": "f47ac10b-58cc-4372-a567-0e02b2c3d479", "radioGroupId": "utg-output-choice-group-unknown_comment_id"} --> Create a new PR

</details>

</details>

<!-- finishing_touch_checkbox_end -->
<!-- tips_start -->

---

Thanks for using [CodeRabbit](https://coderabbit.ai?utm_source=oss&utm_medium=github&utm_campaign=tojemoc/vmp&utm_content=698)! It's free for OSS, and your support helps us grow. If you like it, consider giving us a shout-out.

<details>
<summary>❤️ Share</summary>

- [X](https://twitter.com/intent/tweet?text=I%20just%20used%20%40coderabbitai%20for%20my%20code%20review%2C%20and%20it%27s%20fantastic%21%20It%27s%20free%20for%20OSS%20and%20offers%20a%20free%20trial%20for%20the%20proprietary%20code.%20Check%20it%20out%3A&url=https%3A//coderabbit.ai)
- [Mastodon](https://mastodon.social/share?text=I%20just%20used%20%40coderabbitai%20for%20my%20code%20review%2C%20and%20it%27s%20fantastic%21%20It%27s%20free%20for%20OSS%20and%20offers%20a%20free%20trial%20for%20the%20proprietary%20code.%20Check%20it%20out%3A%20https%3A%2F%2Fcoderabbit.ai)
- [Reddit](https://www.reddit.com/submit?title=Great%20tool%20for%20code%20review%20-%20CodeRabbit&text=I%20just%20used%20CodeRabbit%20for%20my%20code%20review%2C%20and%20it%27s%20fantastic%21%20It%27s%20free%20for%20OSS%20and%20offers%20a%20free%20trial%20for%20proprietary%20code.%20Check%20it%20out%3A%20https%3A//coderabbit.ai)
- [LinkedIn](https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fcoderabbit.ai&mini=true&title=Great%20tool%20for%20code%20review%20-%20CodeRabbit&summary=I%20just%20used%20CodeRabbit%20for%20my%20code%20review%2C%20and%20it%27s%20fantastic%21%20It%27s%20free%20for%20OSS%20and%20offers%20a%20free%20trial%20for%20proprietary%20code)

</details>


<sub>Comment `@coderabbitai help` to get the list of available commands.</sub>

<!-- tips_end -->