# Bia Chrome Extension

Bia is a Manifest V3 Chrome extension that helps QA, developers, and product teams debug web pages, generate test data, execute browser tests, and collect evidence directly from the active tab.

The extension runs as an unpacked Chrome extension. There is currently no `package.json`, build step, transpilation, or dependency installation step in this repository.

## Main Features

- AI chat in the Chrome side panel, with modes for agent actions, read-only chat, and PT/EN translation.
- Natural-language test execution on the active browser tab.
- Browser automation through real clicks, typing, navigation, keyboard input, scrolling, assertions, screenshots, and network checks.
- Saved test library with tags, suites, search, batch execution, repetitions, and optional parallel tab execution.
- Data-driven tests using JSON datasets and `{{variables}}`.
- Environment variables configured per environment, such as `staging`, `qa`, or `prod`.
- Action recorder that converts manual browsing actions into a reusable test case.
- Debug tab for security, accessibility, performance, JavaScript errors, storage, JWT/token previews, cookies, and network requests.
- Element inspector that captures selectors, XPath, roles, labels, and attributes from page elements.
- Accessibility audit through bundled `axe-core`.
- Evidence generation with screenshots, Markdown bug reports, PDF print views, JSON batch exports, and optional `.webm` execution video.
- Optional Jira bug creation and Zephyr Scale import/export/execution result integration.
- Local-only settings storage through `chrome.storage.local`.

## Project Structure

```text
.
├── manifest.json                  Chrome extension manifest and version
├── PRIVACY.md                     Privacy policy
├── icons/                         Extension icons
└── src/
    ├── background/                Service worker modules
    ├── options/                   Dashboard/settings page
    ├── shared/                    Shared constants, templates, labels, variables, insights
    ├── sidepanel/                 Main side panel UI
    ├── vendor/                    Bundled third-party browser scripts
    ├── content.js                 Content script injected into tested pages
    └── page-hook.js               Main-world hook for console/network instrumentation
```

Important files:

- `manifest.json`: extension metadata, permissions, icons, side panel, options page, and current version.
- `src/background/index.js`: central service worker message router.
- `src/background/agent.js`: AI agent loop, tools, prompts, model routing, safety rules, and test execution orchestration.
- `src/background/actions.js`: browser action execution and assertions.
- `src/background/gateway.js`: AI gateway calls for Anthropic and OpenAI-compatible transports.
- `src/content.js`: page scanning, element targeting, assertions, storage diagnostics, debug collection, and recorder support.
- `src/page-hook.js`: captures page console events and `fetch`/XHR network activity from the page context.
- `src/sidepanel/sidepanel.*`: main user interface for chat, run, library, debug, and inspector.
- `src/options/options.*`: dashboard for configuration, feature flags, templates, metrics, imports, and exports.

## Requirements

- Google Chrome 114 or newer.
- Developer Mode enabled in `chrome://extensions`.
- An Anthropic API key or a compatible AI gateway API key.
- Optional Jira and Zephyr credentials if those integrations will be tested.

## Local Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder, for example `C:\projects\BIA-Extension`.
5. Pin/open the `Bia` extension and open its side panel.
6. Open the extension dashboard through the gear button.
7. Configure at least the AI `API Key`.
8. If using a gateway, configure `Gateway URL`; leave it empty to use the direct Anthropic API.

## Optional Local Defaults

The background worker tries to load an optional root-level `config.js` file and copies values from it into local Chrome storage only when the corresponding setting is empty.

This file is not present in the repository and should not be committed if it contains secrets.

Supported exported constants:

```js
export const DEFAULT_API_KEY = '';
export const DEFAULT_MODEL = '';
export const GATEWAY_URL = '';
export const JIRA_URL = '';
export const JIRA_EMAIL = '';
export const JIRA_TOKEN = '';
export const JIRA_PROJECT_KEY = '';
export const ZEPHYR_BASE_URL = '';
export const ZEPHYR_TOKEN = '';
export const ZEPHYR_PROJECT_KEY = '';
```

## Generate a New Version

There is no automated release script in this repository. A version is generated manually by updating `manifest.json` and packaging the extension folder.

1. Update `manifest.json`:

```json
{
  "version": "2.0.4"
}
```

2. Use Chrome-compatible version numbering:

- Use one to four dot-separated integers, such as `2.0.4` or `2.0.4.1`.
- Do not use suffixes like `-beta`, `-rc.1`, or dates with letters.
- Increase the version every time you distribute a new ZIP or upload to the Chrome Web Store.

3. Review the files included in the release:

- Include `manifest.json`.
- Include `icons/`.
- Include `src/`.
- Include `PRIVACY.md` if distributing the policy with the package.
- Include `config.js` only for a private/internal build that intentionally ships default configuration. Do not include real secrets in public builds.
- Do not include `.git/`, OS temporary files, editor files, previous ZIPs, or local notes.

4. Reload the unpacked extension in `chrome://extensions` and confirm the new version appears in the extension card.

## Package the Extension as ZIP

Chrome accepts a ZIP that contains `manifest.json` at the root of the archive.

From PowerShell on Windows:

```powershell
$Version = (Get-Content .\manifest.json | ConvertFrom-Json).version
$Name = "bia-$Version.zip"
Remove-Item $Name -ErrorAction SilentlyContinue
Compress-Archive -Path .\manifest.json, .\PRIVACY.md, .\icons, .\src -DestinationPath $Name
```

Expected result:

```text
bia-2.0.4.zip
```

Before distributing, open the ZIP and confirm the first level contains `manifest.json`, `icons/`, `src/`, and `PRIVACY.md`. The ZIP must not contain an extra parent folder such as `BIA-Extension/manifest.json` unless the target distribution process explicitly accepts that structure.

## Test a Version Locally

Use this checklist before sharing a version.

1. Load the extension:

- Go to `chrome://extensions`.
- Enable `Developer mode`.
- Click `Load unpacked` and select the repository folder.
- If already loaded, click `Reload` on the extension card after each code change.
- Confirm there are no red errors on the extension card.

2. Validate basic UI:

- Open any normal web page, not `chrome://`, `about:`, or another restricted page.
- Open the Bia side panel.
- Confirm the tabs appear: `Chat`, `Executar`, `Testes`, `Debug`, and `Inspetor`.
- Click the gear icon and confirm the dashboard opens.
- Save settings with an API key and optional gateway URL.

3. Validate chat:

- In `Chat`, send a simple read-only question in `Chat` mode.
- Switch to `Tradutor` and translate a short sentence.
- Switch to `Agente` and ask for a safe action on the current page, such as reading page content or clicking a harmless visible control.
- Confirm the stop button appears during execution and the final answer is shown in the thread.

4. Validate test execution:

- Open a test page or internal QA environment.
- Go to `Executar`.
- Run a small test case, for example:

```text
1. Verifique que a página carregou
2. Verifique que existe um texto visível na página
```

- Confirm live steps are displayed.
- Confirm the final result shows a verdict, executed steps, and the AI report.
- Use `Salvar Teste` and confirm the test appears in `Testes`.

5. Validate data-driven tests:

- Add a dataset in `Dados`, for example:

```json
[
  { "termo": "notebook" },
  { "termo": "monitor" }
]
```

- Use `{{termo}}` in the test case.
- Confirm the extension expands and runs one execution per dataset row.

6. Validate recorder:

- Click `Gravar`.
- Perform a few safe actions on the page.
- Click `Parar e gerar`.
- Confirm a numbered test case is generated in the test input.

7. Validate library and batch:

- Save at least two tests.
- Select tests in `Testes`.
- Run selected tests sequentially.
- If safe for the target site, test `2 abas` or `3 abas` parallel execution.
- Export batch JSON and confirm the downloaded file opens and contains results.

8. Validate Debug and Inspector:

- In `Debug`, click `Analisar Página`.
- Confirm security, accessibility, performance, token/storage, network, and JavaScript error sections render without crashing.
- In `Inspetor`, click `Inspecionar`, then click an element in the page.
- Confirm selector, XPath, role, and attributes appear in the panel.

9. Validate evidence outputs:

- Generate a result and click `PDF`; confirm the print view opens.
- Create a bug report and test `Copiar` and `Baixar .md`.
- If execution video is enabled, confirm the `.webm` preview and download work while the side panel remains open.

10. Validate optional integrations only when configured:

- Jira: create a test bug in a safe project and confirm the returned issue URL opens.
- Zephyr: import/export a test case and push a test execution result to a safe cycle.

## Troubleshooting

- `Configure a API Key em ⚙️`: add the API key in the dashboard settings.
- `Esta página não pode ser testada`: Chrome blocks extensions on restricted pages such as `chrome://`, `about:`, and other extension pages.
- Debugger or CDP errors: close Chrome DevTools on the tested tab and retry. Chrome allows only one debugger client per target tab.
- No page actions happen: reload the target page and reload the extension in `chrome://extensions`.
- Network/debug data is empty: keep the Bia panel active before reproducing the page action, because fetch/XHR capture starts after injection.
- ZIP install fails: confirm `manifest.json` is at the ZIP root and the version number is valid.

## Privacy Notes

Settings and credentials are stored locally in Chrome storage. The extension has no backend of its own. Page content is sent only to the AI provider or compatible gateway configured by the user when a chat, debug request, or test execution requires it. See `PRIVACY.md` for details.
