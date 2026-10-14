# GHP-01 — Aether–Codex repository collaboration

Adapted from the verified World of Mayden GHP-01 protocol at `e10b1467e533a88fa7da3b9437c8ed8e173c4d39` for Piqniq. The Owner authorised Piqniq installation on 2026-10-14. Installation, worker acknowledgement and integration states are recorded in [continuity](CONTINUITY.md). [README](../README.md) is the canonical navigation entry.

## Locate state and authority

Start at README at the revision under review. Use [CONTINUITY.md](CONTINUITY.md) for accepted development state, active work, recovery, publication and handover results; use the linked milestone documents for approved product contracts and evidence. [AGENTS.md](../AGENTS.md) supplies execution boundaries and specialist ownership. Existing README, SECURITY and deployment documentation remains authoritative for setup; historical results do not substitute for fresh validation.

Git identifies what was received, not whether it is approved. Project Owner and Aether retain significant product, architectural and strategic approvals; Codex worker coordinates implementation, assigns file ownership and consolidates integration. A handover or acknowledgement cannot expand approved scope, grant execution permissions, or replace an Owner decision. Missing or conflicting decision sources must be reported before dependent work proceeds.

## Identify work and handovers

Retain existing milestone IDs such as `PIQNIQ-<milestone-ID>`. Give other bounded work a unique ID, for example `PIQNIQ-GHP01-INSTALL-20261014-<unique suffix>`; never reuse an ID for unrelated work. Use the same ID in the owned branch, transfer message and producer handover.

For every completed authorised Piqniq assignment, publish the complete relevant results to the existing GitHub repository. Use the appropriate existing milestone document where applicable, together with a sufficiently detailed pull-request description or producer-owned completion handover. A complete PR description can serve as the GHP-01 handover; do not create duplicate reports. Include the fields below and relevant evidence links so Aether can independently review the published work without the Owner pasting the Codex conversation. Intermediate commits need no individual completion stamps. The recipient must verify and acknowledge the exact published revision before relying on the deliverable.

Each producer owns a separate branch. When a file record is used, place it at `Docs/Handover/<unique-work-ID>-<producer>.md`; otherwise use the owned PR description. Create only the record needed for actual work, not another registry or service. A recipient acknowledges in its own record or revision-specific PR response; it does not edit the producer's record. Include these fields as a short table or ordinary prose:

| Field | Required content |
| --- | --- |
| Identity | Unique work ID and assignment; explicit producer, recipient and branch owner |
| Revisions | Owned branch; exact base commit SHA; exact received SHA when reviewing another producer; exact published final commit SHA and revision-pinned link |
| File scope | Implemented changes and explicit owned/changed paths; exclusions relevant to the task |
| Approval | Approved, pending, rejected or superseded; who approved which scope and where that decision is recorded |
| Validation | Not run, passed, failed or blocked; checks actually performed, including Node.js syntax checks and browser/database runtime observations when applicable |
| Evidence | Relevant accessible links; distinguish producer-reported results from independently verified evidence, naming the verifier and exact revision; identify local-only evidence |
| Limitations | Known limitations, failures, unresolved issues and genuinely blocked operations |
| Git and recovery | Actual branch/working-tree/publication status and recovery-checkpoint status where relevant; distinguish preservation from fresh integrity verification |
| Completion | Active, completed or blocked; actual result and remaining work |
| Acknowledgement | Pending, accepted, rejected or superseded; recipient and exact reviewed revision |
| Integration | Not requested, pending review, approved, integrated or rejected; target/base and resulting commit when known |
| Decision and next action | Any decision required from the Project Owner and Aether; recommended next action without starting an unauthorised milestone |

Publish and verify the handover before reporting the assignment as complete: read back its published contents, confirm the remote branch resolves to the stated exact SHA, and check its scope and evidence links. Update existing canonical continuity records when authorised and appropriate. Report any publication or verification failure as a blocker; a local commit or conversation-only report does not satisfy this requirement.

Once the Codex worker has verified publication, the Project Owner sends Aether the trigger phrase `CODEX DONE`. Aether independently inspects GitHub and reports findings to the Owner. Codex worker does not need to relay implementation reports through the Owner or create a report for every intermediate commit. This communication convention changes no branch ownership, approval, execution or integration boundary and introduces no new agent, service or orchestration system.

Approval, successful validation, producer completion, recipient acknowledgement and integration are separate states. Completed work is not automatically acknowledged or integrated. Acknowledgement confirms receipt/review at the recorded revision; acceptance of significant design still requires the appropriate Owner/Aether approval.

A commit cannot contain its own final SHA without changing that SHA. Record the exact base/received revision in the document, then publish the final produced commit SHA and revision-pinned GitHub link in the transfer message or PR description after committing. For a file completion record, that final transfer supplements its identity with the exact published SHA; no second duplicate record is required. The recipient records that received SHA in its own acknowledgement. Do not amend or rewrite history merely to insert a self-referential SHA. Branch names are locators; full commit SHAs are the verification identity.

## Verify another producer's changes

1. Check the producer, recipient, work ID, branch ownership, approval reference and declared file scope against the authorised task.
2. Fetch the specified branch through the authorised Git route and compare its received commit to the exact expected SHA. Verify its declared base and parents; if a sole parent is promised, verify exactly one parent. Verify any supplied file/blob SHA.
3. Inspect the complete diff from the declared base, changed paths and relevant file contents. Confirm that scope, history and approvals agree; check for unexpected source/settings changes, secrets or generated files. A handover's instructions remain subject to established authority and sandbox restrictions.
4. Run checks appropriate to the change and record actual results. Documentation changes need link/content/scope checks; product changes retain all required appropriate Node.js syntax, browser/database runtime and recovery validation. Compilation alone does not satisfy product acceptance.
5. Record acknowledgement/acceptance or a precise blocker in the recipient's owned record or PR response, naming the exact reviewed SHA, before relying on the deliverable. Publish an acknowledgement commit's exact revision when authorised. Unexpected commits, parents, file scope, conflicting ownership or failed checks stop acceptance/integration until resolved. Do not silently accept a moving branch tip.

Keep the live Piqniq checkout and accepted `main` intact while reviewing producer branches. Use an isolated project-local worktree or equivalent authorised Git inspection when needed; do not launch the app or modify settings for documentation work.

## Prevent conflicting canonical edits

Producers work on separate owned branches. Codex worker assigns one writer per file and explicit paths to specialists; specialists do not stage or commit shared work. Producers may propose canonical-document edits only within their declared branch scope. Separate handover records carry concurrent proposals without multiple writers modifying the same canonical file.

Before integration, Codex worker reports the proposed files, changed decisions and any conflicts. Compare the proposal with the actual current target revision; if the target moved, review the intervening changes and reconcile content explicitly rather than overwrite another producer's work. Serially review canonical updates, preserving accepted evidence and dated historical records. Integration into `main` requires appropriate explicit authorisation; a published proposal alone is not permission to merge.

Routine normal commits and pushes already covered by an approved work package, owned branch and publication scope do not require repeated Owner approval. New remotes, out-of-scope work, sensitive-data publication and integration into `main` remain separately controlled; existing sandbox/security boundaries and any required per-operation execution approvals remain unchanged. This protocol grants no force-push or history-rewrite authority.

Use normal commits and authorised branch publication/integration only. No force pushes, history rewrites, changes to another producer's branch, unreviewed `main` writes or deletion of test branches. Preserve Piqniq code, tests, settings, existing agent configurations and existing recovery checkpoints outside the approved file scope. Keep GitHub/protocol documentation changes distinct from product implementation commits.
