# Supabase integration

This supersedes the memory-only data boundaries in the Phase 1 PLATFORM.md.
The editor and platform remain Vite + vanilla JavaScript + Three.js. The only new
runtime dependency is the requested official `@supabase/supabase-js` SDK.

## Configuration

`.env.local` has been configured with the project URL and the publishable key
supplied by the project owner. It is ignored by Git. `.env.example` is safe to
commit. Restart Vite after changing environment variables.

Required browser variables:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_public_key
VITE_OLLAMA_MODEL=llama3.2
```

Never use a secret/service-role key in a VITE variable. Supabase SDK session
persistence stores session tokens in browser storage; passwords are not stored
by application code. The API key identifies the application, not the user.
RLS and authenticated JWTs enforce data access independently of route guards.

In Supabase Auth settings, configure Site URL and allowed redirect URLs for the
actual deployment origin, including `/login`. For local tests these may include
`http://localhost:5173/login` and `http://127.0.0.1:5174/login`.
Registration supplies `full_name` and `username` in Auth metadata. The existing
schema trigger creates the profile and copies full_name. A confirmed session
updates the caller's profiles.username if it is still empty. A username conflict
is reported explicitly. Email confirmation without a session is not treated as
a successful login. No separate users/passwords table is created.

## Schema and migration review

`supabase/schema.sql` is an unchanged copy of the complete 547-line SQL supplied
with the task. It was not run against the live project. Do not rerun this create-
table script on an existing database.

**Review both `supabase/migrations/20261121_scene_commit.sql` and the corrective
`supabase/migrations/20261123_scene_commit_hardening.sql` before applying them
in order in Supabase SQL Editor. If the first migration is already applied,
apply only the corrective migration. Do not rerun the original schema.**
The project owner elected to review/apply SQL manually.
No deployed SQL was changed by this implementation.

The migration adds a narrow server-side `commit_forma_scene` function. It:

- Checks auth.uid() and can_edit_project(project_id) before touching any rows.
- Locks the project row and rejects a stale expected scene_revision.
- Validates metadata identifiers, project scope, missing parents and cycles.
- Upserts searchable scene_objects in the same transaction as the revision change.
- Keeps inactive metadata tombstones so comments/measurements retain foreign keys.
- Atomically points the project at an already-uploaded immutable snapshot path.
- Revokes direct authenticated UPDATE of scene_path, thumbnail_path,
  scene_revision and scene_metadata so the app cannot bypass revision comparison.
- Uses SECURITY DEFINER with an empty search_path, fully qualified application
  tables, static SQL, and authenticated-only execution. It is a trusted server
  boundary with explicit caller authorization, not a frontend admin credential.

The corrective migration closes the first migration's direct-write and mutable-
Storage bypasses. Project name/description/status updates and scene SELECT remain
available. No existing tables are dropped or recreated. See the security review
below for its additional policies, private configuration table and commit receipts.

The original schema deliberately permits anonymous profile reads. This was
preserved, not expanded; don't add private contact data to public profiles.

## Project management

Dashboard and Projects use the real projects table and project_members roles.
There is no mock-data fallback on network or authorization failure. The old
memory service and mock records are now under tests/fixtures only.

Owner/editor/viewer roles determine UI capabilities. Delete is owner-only,
with a confirmation dialog. Actual permissions remain enforced by Supabase,
including when a browser ignores disabled controls. Project listing currently
loads up to 1,000 accessible records, searches names, and supports server sorting.
Thumbnails use short-lived signed URLs from the private forma-projects bucket.
Missing previews display a placeholder, not an invented saved scene image.

### Project creation RLS regression fix

The Create Project form already sends name, description and its selected category;
the original category-only metadata satisfies projects_initial_scene. The failure
was `.insert(...).select(...).single()`: INSERT RETURNING also enforces the projects
SELECT policy, whose STABLE can_read_project function cannot see the just-inserted
row in that statement's snapshot. PostgreSQL raises a new-row RLS violation and
rolls back the INSERT. Local PostgreSQL tests reproduce this exact failure with
an otherwise valid owner/category payload.

ProjectService.create now verifies the current user through AuthService.requireUser
(getSession plus server getUser), generates the UUID, and sends only explicit
creation fields: owner_id from that verified user, trimmed name/description,
scene_path=null, thumbnail_path=null, scene_revision=0, and category-only metadata
(or {} for an empty category). Caller-supplied ownership and scene fields are ignored.
Category must be text of at most 100 characters, matching the restrictive policy.
It inserts without RETURNING, then fetches the committed project and memberships
in a separate request. A failed follow-up read explicitly says the project was
created and asks for a My Projects refresh; it never retries the successful INSERT.

The existing form callback clears filters, refreshes My Projects, and renders the
normal `/editor/<UUID>` link. Tests use the production service against local real
RLS to verify ownership, all form categories, list/read/editor-route resolution,
empty initial scene state, and rejection of direct other-owner INSERTs. Unit tests
also cover missing/revoked sessions and no INSERT RETURNING. The opt-in hosted test
checks these creation fields, listing and ownership isolation too. A signed-in
hosted browser round trip remains a manual smoke test; no live credentials were
used for this fix. No policies, migrations, editor tools or AI code were changed.

Deleting a project removes its database row and cascading dependent records.
Private Storage objects are not automatically deleted by PostgreSQL cascades.
All forma-projects files are append-only for browser roles, including owners.
A trusted Storage API cleanup job is needed for unreferenced uploads and deleted
project prefixes. It must retain all current scenes and version/commit references.
Never delete Storage metadata with direct SQL or delete a current snapshot.

## Scene Save / Load

`SceneSerializer` serializes editable objects only, not helpers or event handlers.
It writes explicit BufferGeometry JSON (positions, indices, normals, UVs, groups),
material JSON, transforms, visibility, locks, stable UUIDs, parent links, primitive
parameters, counters, selection and camera state. Primitive constructor JSON alone
would lose Extrude/Inset/Bevel/deformed vertices, so those buffers are always saved.

Selection highlight, Wireframe and X-Ray overrides are stripped from persisted
materials without changing live rendering. Numeric editor IDs stay compatible
with existing Ollama commands; persistent UUIDs survive save/load and Undo/Redo.
Malformed geometry/hierarchies are rejected before replacing live objects.
Current support is the editor's Cube/Sphere/Cylinder/one-level groups and Basic/
Standard materials, without textures or morph targets. The client scene limit
is 25 MB, 1,000 objects and 2 million position vertices.

Save uploads JSON and a PNG thumbnail through the Storage SDK into unique paths:

- `forma-projects/<project-id>/scenes/<uuid>.json`
- `forma-projects/<project-id>/thumbnails/<uuid>.png`

Only then does the atomic RPC commit metadata and the new revision. A conflict
leaves the local scene intact and asks the user to reload the newest saved scene.
No unsafe plain projects UPDATE fallback is used. If the function isn't deployed,
Save returns a clear setup error and never reports success.

On ambiguous network errors uploads are retained: the server may have committed
successfully, so deleting the upload could destroy the saved scene. Append-only
Storage protection also means all uncommitted orphans need trusted maintenance.
Load/download errors do not silently replace an existing saved scene with a cube.

The editor shows Save, Reload, dirty/saved status and a before-unload warning.
Reload asks before discarding unsaved edits. Edits made during an upload remain
dirty after that upload completes. This is explicit save, not autosave. Returning
to Projects without saving discards local edits; save before navigating away.
`/editor/demo` remains public, temporary and clearly marked as unsaved.

## AI history and trusted backend work

Ollama + Llama 3.2 still execute locally behind validateCommand. No arbitrary
model-generated JavaScript is evaluated, and stored history is never replayed.

The browser can read active ai_models and the current user's conversations,
messages and actions, and create its own conversation/user messages under RLS.
Only role=user messages with sender_id=current user and model_id=null are written.
Assistant output displayed after local execution is labeled local/not stored.

The supplied policies forbid browser INSERT of assistant/system/tool messages
and all ai_actions writes. A trusted backend or authenticated server function is
still required to validate/record assistant results and execution audit data.
No service-role key or pretend successful assistant/action persistence was added.
Invitations, audit-log writes, reports and training were not implemented.

## Verification

- `npm test`: existing modeling tests plus route/auth/service/serialization tests.
- `npm run build`: production Vite build.
- `node --env-file=.env.local scripts/supabase-audit.mjs`: read-only connectivity
  and anonymous access audit; no users/projects are created.

Observed live audit: Auth health 200; anonymous project/scene/AI table reads
rejected with 42501; profile reads allowed as defined by the supplied schema.
At audit time `commit_forma_scene` was not deployed.

An opt-in live test is in tests/supabase-live.test.js. It is skipped by default.
Use two existing disposable confirmed test accounts; never paste passwords into
chat or commit them. Set FORMA_INTEGRATION_RUN=1, FORMA_TEST_EMAIL_A,
FORMA_TEST_PASSWORD_A, FORMA_TEST_EMAIL_B, FORMA_TEST_PASSWORD_B in your local
process, and run:

```
node --env-file=.env.local --test tests/supabase-live.test.js
```

It creates a temporary project, checks unrelated/viewer/editor/owner permissions,
Storage access, real snapshot reopen, concurrent-save conflict, logout and cleanup.
It also checks deployed Storage overwrite/delete denial and direct scene DML denial.
The project row is cleaned up, but append-only test files intentionally remain for
trusted Storage API cleanup; the test prints the disposable project prefix.
It never creates Auth accounts. This test was not run because two test-account
sessions and the reviewed save migration were unavailable. Unit/contract tests
must not be mistaken for a completed live cross-user security audit.

Manual smoke test after applying the migration:
1. Register with a real controlled email, confirm it, sign in and refresh.
2. Create/rename a project; inspect it from another unrelated account.
3. Add editor/viewer membership with an authorized owner/admin workflow.
4. Model, group, edit faces, save and reopen; check materials/hierarchy/UUIDs.
5. Save from two tabs at the same revision: the second must show a conflict.
6. Reload the latest saved scene explicitly, then test a viewer cannot save.
7. Send an Ollama command, reopen history, and distinguish stored user messages
   from local-only assistant results. Check sign-out protects direct project URLs.

## Implementation files

New: src/services/supabaseClient.js, SceneSerializer.js, SceneService.js,
EditorSession.js, ConversationService.js; .env.example; ignored .env.local;
supabase/schema.sql; supabase/migrations/20261121_scene_commit.sql;
scripts/supabase-audit.mjs; tests/supabase-services.test.js,
tests/supabase-live.test.js; tests/fixtures/MemoryProjectService.js and
mockProjects.js (moved out of src); SUPABASE.md.

Modified: package.json/package-lock.json, .gitignore, src/main.js;
src/services/AuthService.js and ProjectService.js; src/routing/Router.js;
src/pages/AuthPage.js, DashboardPage.js, ProjectsPage.js, EditorPage.js,
LandingPage.js; src/components/Shell.js, ProjectCards.js, ProjectDialog.js;
src/editor/ObjectService.js, SelectionService.js, HistoryService.js, ViewService.js,
ObjectWorkflow.js, InputController.js, MeshEditor.js, ModifierService.js,
CommandService.js, EditorUI.js, AIController.js;
src/styles/platform.css, editor-theme.css; tests/commands.test.js,
platform.test.js; README.md and PLATFORM.md.

Official references: https://supabase.com/docs/guides/api/api-keys,
https://supabase.com/docs/reference/javascript/auth-signup,
https://supabase.com/docs/reference/javascript/auth-onauthstatechange,
https://supabase.com/docs/reference/javascript/storage-from-upload.

## Corrective scene security review (2026-11-23)

Files for this review: new `supabase/migrations/20261123_scene_commit_hardening.sql`
and `tests/scene-migration.test.js`; updated `tests/supabase-live.test.js`, this
document, and package.json/package-lock.json (PGlite development-only test engine).
The original schema, original migration and frontend save code remain unchanged.
No SQL, test uploads or test accounts were sent to the deployed project in this review.

### Write boundary and definer security

The supplied schema grants both table-level DML and column-level UPDATE on
scene_objects. The corrective migration explicitly revokes BOTH; simply revoking
table UPDATE does not remove column grants. Scene SELECT/RLS stays intact. It also
revokes direct project snapshot-column UPDATE and blocks initial project INSERTs
that seed a scene pointer/revision or scene-owned metadata. Existing frontend
create({owner_id,name,description,scene_metadata:{category}}) still works.

The RPC retains the exact six-argument signature and JSON project response. Only
authenticated has EXECUTE; the function checks auth.uid(), locks the project,
then authorizes the owner or locks an editor membership with FOR SHARE. A viewer,
unrelated account or null identity cannot save. The definer owner is the trusted
migration executor (normally the SQL Editor's postgres role), not authenticated.
Review ownership when applying; do not grant a browser role ownership/membership
in the owner role. There is no dynamic SQL, client-controlled role, or session flag
used as an authorization bypass. search_path is empty; all application, auth and
Storage references are schema-qualified. No helper with elevated EXECUTE is exposed.
This uses the existing trusted migration owner rather than introducing a new
cluster-wide login or giving clients access to a new privileged role.

### Storage identity, freshness and immutability

NULL/empty/traversal/URL/foreign-project/noncanonical paths are rejected. New paths
must exactly match `<project UUID>/scenes/<lowercase UUID>.json`; optional thumbnails
must match `<project UUID>/thumbnails/<lowercase UUID>.png`. A matching row must
exist in the PRIVATE forma-projects bucket. The RPC locks the bucket and object
metadata rows, requires a nonempty Storage version, timestamps, JSON MIME type and
size 1..25 MiB; supplied thumbnails require PNG MIME and size 1..10 MiB.

RESTRICTIVE UPDATE/DELETE policies deny replacement, moves and deletion throughout
forma-projects for anon/authenticated, even if permissive policies also allow them.
INSERT/SELECT remain under existing project RLS, compatible with unique filenames
and upsert:false in SceneService. This intentionally also protects legacy paths and
uncommitted uploads: conditional protection only after commit would leave a race
between upload, overwrite and commit. Other buckets are unaffected.

A private epoch recorded when the migration is applied excludes pre-hardening
uploads from NEW commits (their bytes might already have been overwritten). Existing
saved scenes can still be read. Fresh uploads must also be newer than the last
successful commit; a previously committed path or Storage object ID cannot be reused.
One immutable scene_commits receipt records each revision's Storage ID, version,
updated_at, path, effective thumbnail path, metadata and author. Browser roles can
only read accessible receipts. Old files/receipts remain available for future
project_versions workflows; no restore/version UI was added. An omitted thumbnail
preserves the current preview. A receipt's thumbnail ID/version is null when the
preview was inherited rather than newly supplied.

Storage metadata is not the physical S3 object. This SQL does NOT parse the uploaded
JSON bytes or prove that p_objects matches them, check geometry/material validity
on the server, or hash the actual blob. Frontend validateScene is useful UX but
can be bypassed by a custom client. A malicious editor can still upload non-JSON
bytes labeled application/json or metadata inconsistent with the blob. A trusted
backend must download, validate and bind the actual bytes/derived object rows before
this can be claimed as complete server-side snapshot validation. Do not solve this
by accepting a client-provided hash as proof. Trusted service-role/DB-admin writes,
bucket changes and out-of-band S3 deletions bypass browser RLS and must be controlled
operationally. Preexisting missing/corrupted snapshots cannot be repaired by SQL.

### Metadata, hierarchy and atomicity

ShapeFactory creates Cube, Sphere and Cylinder; the workflow adds Group. SQL accepts
exactly those four types. Deformed meshes keep their primitive type and full buffer
geometry in the blob. SQL enforces numeric transform triples, Euler rotation/order,
nonblank names, UUIDs, unique IDs, same-project identity, existing Group parents and
one-level grouping. A Group cannot have a parent: that rule rejects self/indirect
cycles and nested groups consistently with validateScene. Child-before-parent input
works with the supplied deferred composite FK.

The project row lock and expected_revision implement compare-and-swap; one competing
save wins. A second same-project save fails with SCENE_CONFLICT. A post-upsert check
also catches a UUID claimed concurrently by another project after the initial check.
The parent FK is checked inside the call. Removed objects remain tombstones to keep
comment/measurement references valid; their stale parents are cleared. Active rows
replace their transform/properties completely (no stale per-object property merge);
present_in_scene and scene_revision are always server-owned overrides.

Only format/format_version/object_count may appear in RPC scene_metadata; their
values must match v1 and the row count. SQL derives them again and replaces those
three keys while preserving project-level category/other existing metadata. Arbitrary
project settings cannot be patched through save. These rows are searchable metadata;
the blob remains the frontend restoration source, subject to the validation limit above.
All upserts, tombstones, receipts and pointer/revision updates are one transaction.
Late errors roll back all of them. Storage uploads are separate transactions and can
remain orphaned after a failed commit. Long-running or deadlocked transactions can
fail; they cannot partially advance a saved scene. Retrying after an ambiguous
response requires reloading the revision first, not replaying a committed path.

### Local verification and remaining manual tests

`tests/scene-migration.test.js` runs the actual original application schema and both
migrations in PGlite (PostgreSQL WASM), with local auth/storage table stand-ins.
Only the optional pgcrypto extension installation line is removed for that engine;
the core UUID generator is available. Tests execute real ACLs, RLS, PL/pgSQL, FKs and
rollback. They cover anon/viewer/unrelated/editor access, column-grant bypasses,
initial pointer injection, invalid paths/buckets/MIME/size/version/freshness,
duplicate/cross-project IDs, cycles, frontend rows, metadata replacement, tombstones,
history retention, and injected late failure rollback. PGlite is a dev dependency;
it is not imported by the Vite app or shipped in production assets.

PGlite uses a single connection: its competing-save test verifies expected-revision
semantics, NOT simultaneous backend row-lock scheduling. The opt-in live suite uses
independent SDK requests for real concurrent saves. It remains skipped without the
explicit two-test-account configuration. Before deployment approval, manually test
on a disposable Supabase project after reviewing/applying both migrations:

1. Standard SDK upload/upsert:false, metadata MIME/size/version/timestamps, private
   download, signing, thumbnails and Save/Reload from the existing editor.
2. .update(), upsert:true, .move(), copy onto an existing path, signed-upload URLs
   and .remove() against current, historical and uncommitted project files. Confirm
   old bytes still download and backend metadata maintenance remains compatible.
3. Independent simultaneous saves, concurrent editor demotion/removal, a cross-project
   UUID collision, and injected failure after metadata writes; verify full rollback.
4. Unrelated/viewer access, receipt SELECT RLS, project creation/rename, grouped and
   deformed mesh round trips, unchanged category and absent-thumbnail preservation.
5. Trusted cleanup using Storage API, retaining current/project_versions/scene_commits
   references. Include deleted-project prefixes and obsolete pre-hardening uploads.
6. Review actual function ownership, inherited grants, any additional Storage policies
   or endpoints and outstanding signed upload capabilities. RLS tests with local
   stand-ins do not replace this hosted Storage/API audit.

Supabase references: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[Storage schema](https://supabase.com/docs/guides/storage/schema/design).
