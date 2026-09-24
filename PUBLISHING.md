# Publishing

The GitHub Actions workflow creates a validated release ZIP whenever `manifest.json` contains a version that does not already have a matching GitHub release. After one-time Chrome Web Store setup, the same workflow can upload that ZIP and submit it for review automatically.

## First Chrome Web Store submission

The Chrome Web Store API updates existing items; creating and completing the first item still requires the Developer Dashboard.

1. Register a Chrome Web Store developer account and enable two-step verification.
2. Push a commit with a new `manifest.json` version. The workflow creates `chatgpt-conversation-exporter.zip` in the matching GitHub release.
3. In the Developer Dashboard, select **Add new item** and manually upload that release ZIP.
4. Complete the Store Listing, Privacy, Distribution, and test-instruction fields. Ready-to-paste copy is in [STORE_LISTING.md](./STORE_LISTING.md).
5. Upload a 440x280 small promotional image and at least one sanitized 1280x800 or 640x400 product screenshot. See [store-assets/README.md](./store-assets/README.md).
6. Submit the first version manually. Do not enable automated publishing until the item exists and its listing and privacy fields are complete.

The public privacy-policy URL is:

`https://github.com/diogovalada/chatgpt-conversation-exporter/blob/main/PRIVACY.md`

## Enable GitHub Actions publishing

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create a service account. No project role is required for the Chrome Web Store API itself.
3. Create a JSON key for that service account and keep it private.
4. In the Chrome Web Store Developer Dashboard, open **Account** and add the service account email. Chrome currently permits one service account per publisher.
5. In the GitHub repository, create an environment named `chrome-web-store`. Add required reviewers to protect production publishing.
6. Add the environment secret `CWS_SERVICE_ACCOUNT_JSON` containing the complete service-account JSON key.
7. Add environment variables `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID` with the values from the Developer Dashboard.
8. Add the repository variable `CWS_PUBLISH_ENABLED` with the value `true`.

The JSON key is passed directly to the publisher script and is never written to the repository or release package. Rotate the key immediately if it is exposed.

## Release an update

1. Update and test the extension.
2. Increase `version` in `manifest.json`. The Chrome Web Store rejects packages that do not have a higher version.
3. Commit and push to `main`.
4. GitHub Actions validates all manifest references, checks JavaScript syntax, runs the test suite, creates the ZIP and GitHub release, uploads the package to the existing Chrome Web Store item, and submits it for review.

The store publishes the update after review because the workflow uses `DEFAULT_PUBLISH`. It sets `blockOnWarnings` to `true`, so policy warnings stop the submission instead of being silently ignored.

## Manual retry and recovery

- If the release exists but the store job never ran, open **Actions**, run **Build and publish extension**, and enable `publish_existing`.
- If upload succeeded but submission failed, inspect the Developer Dashboard before retrying. Fix warnings there or publish the already-uploaded package manually rather than repeatedly uploading the same version.
- To disable store publishing without changing the workflow, set `CWS_PUBLISH_ENABLED` to `false` or remove it. GitHub release ZIPs will still be built.
- Changes to store visibility must be published manually once before the API can reuse the new visibility setting.

## Local validation

Run the same source validation and tests used by CI:

```powershell
node scripts/validate-extension.mjs .
Get-ChildItem background.js,popup.js,content,scripts,tests -Recurse -File -Include *.js,*.mjs |
  ForEach-Object { node --check $_.FullName }
Get-ChildItem tests\*.test.js | ForEach-Object { node $_.FullName }
```
