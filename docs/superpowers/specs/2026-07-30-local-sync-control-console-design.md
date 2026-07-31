# Local Sync Control Console Design

## Goal

Create a local clickable control page for Feishu sync operations and stop treating the separate `逾期回款项目明细表` as part of the default workflow.

## Decisions

- Add a local-only HTTP console at `http://localhost:3000`, started by `npm run control`.
- The console will expose buttons for dry run, full sync, invoice sync, views sync, and listing available steps.
- Personnel collaborators, role members, and fine-grained permissions are maintained manually in Feishu advanced permissions; the console must not expose permission sync actions.
- The console will run the existing `sync:all` script so command-line and browser behavior stay aligned.
- The default `sync:all` flow will exclude `boss-dashboard`; the old script remains available for explicit use only.
- `sync:views` will organize `项目开票进度表` views so `开票逾期` and `回款逾期` are visible through the main progress table instead of a separate overdue receivables table.

## Safety

- The console binds to localhost only.
- One sync job runs at a time; additional clicks while a job is active are rejected.
- Dry run remains the recommended first action.
- Existing Feishu source tables remain untouched.

## Verification

- Add tests for default step selection and console command mapping.
- Run `npm test`.
- Start `npm run control` and verify `http://localhost:3000/health` responds.
