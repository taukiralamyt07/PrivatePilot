# Private Pilot

**Your private browser assistant**

Private Pilot is a privacy-first Chrome browser extension powered entirely by local on-device AI. It operates client-side inside your browser using Google Gemma 4 via Chrome's WebGPU pipeline.

---

## Clean, Bright & Premium UI Redesign

Private Pilot features a refined, distraction-free interface inspired by modern productivity apps:

- **Warm, Bright Visual Style**: Warm off-white canvas (`#f8fafc`), crisp white card surfaces (`#ffffff`), subtle neutral borders (`#e2e8f0`), dark charcoal typography (`#0f172a`), and restrained blue accents (`#2563eb`).
- **Streamlined Main Screen**:
  1. **Header**: Clean brand mark, title, subtitle ("Your private browser assistant"), clear conversation button, and settings trigger.
  2. **Current Webpage Card**: Compact card featuring one prominent **"Read this page"** button, clear inline states (Not read yet, Reading page…, Page ready, and Errors), text preview drawer, and dedicated page actions.
  3. **Phase 5: "Explain Simply" Feature**:
     - **Contextual Action Button**: The prominent **"Explain Simply"** button appears as soon as webpage content has been extracted.
     - **Beginner-Friendly 3-Part Explanation**: Generates a structured response with a **Short Summary** (1-2 plain sentences), **Key Points** (3 bullet points), and **Difficult Terms Explained** (plain English definitions of technical terms or jargon).
     - **Strict Grounding**: Prompt constraints strictly anchor the explanation to extracted webpage text. If information is not in the text, it explicitly states so rather than hallucinating facts.
     - **Safe Long Webpage Handling**: Automatically bounds context safely to stay well within Gemma 4's 1024-token context window and displays a "Long page (truncated)" indicator when applicable.
     - **Model Load Guard**: Does not auto-load the model; if unloaded, gently directs the user to Settings to load Gemma 4 first.
     - **Quick Actions**: Includes companion one-click actions: **Summarize page** and **Ask about page**.
  4. **Phase 6 & 7: Safe Form Filling & Smart Profile Autofill**:
     - **One-Time Local Profile Setup**: In Settings → **"My Profile"**, enter and edit reusable profile details: Full name, Email address, Phone number, College/organization, Course/job title, optional Address, City, State, Postal code, and custom fields.
     - **Local Storage Privacy**: Stored 100% on-device in `chrome.storage.local` private to this browser profile. Never sent to any server, cloud API, analytics, or external AI provider.
     - **Deterministic Smart Field Matching**: One-click **"Fill from My Profile"** matches eligible visible form fields using deterministic rules first (labels, placeholders, autocomplete, input types).
     - **Zero Model Overhead for Deterministic Autofill**: Local Gemma 4 is never downloaded or loaded merely to match profile fields. Local AI is only consulted if needed to classify ambiguous field labels without sending personal data.
     - **Review and Approval Before Filling**: Every proposed value is displayed in an editable review list with checkboxes. Only approved fields are injected after clicking **"Approve and Fill"**.
     - **Strict Sensitive Safeguards**: Passwords, payment card numbers, CVVs, security PINs, OTPs, auth tokens, SSNs, and CAPTCHAs are strictly excluded.
     - **Never Submits Forms**: Only populates the reviewed fields and dispatches DOM input/change/blur events with React `_valueTracker` support.
     - **Reliable DOM Injections**: Fixed previous "Failed to fill" issues with active-tab resolution, origin permission verification, and multi-tier element resolution.
  5. **Chat Area**: Highly readable, calm message bubbles with distinct user and assistant styling, streaming cursors, markdown bold headers, and referenced page tags.
  6. **Bottom Input Dock**: Clean textarea with placeholder, Enter to send, Shift+Enter for newlines, friendly unloaded-model guidance, and a subtle "Designed for local, private AI" indicator.
- **Advanced Controls in Settings**:
  - **My Profile**: Enter, update, or delete your reusable profile for instant autofill.
  - Model lifecycle: Explicit **Load / Unload Gemma 4** controls and live status badge.
  - Model variant selection: `gemma-4-E2B-it-q4f16_1-MLC` (Recommended) vs `q4f32_1-MLC`.
  - Generation controls: Context window (512 or 1024 tokens), maximum response tokens (128 or 256 tokens), temperature slider with human-readable helper text.
  - Cache management: One-click GPU memory cache disposal.
  - Collapsible diagnostics: Expandable **"Advanced Diagnostics & Hardware"** accordion showing WebGPU availability, adapter details, shader-f16 support, and VRAM limits.
  - Data & Privacy management: Clear conversation history and zero-telemetry confirmation.

---

## Project Structure

```text
PrivatePilot/
├── public/
│   ├── manifest.json            # Manifest V3 config (sidePanel, activeTab, scripting, tabs)
│   └── icons/                   # Extension icons (16px, 48px, 128px)
├── scripts/
│   └── generate-icons.js        # Script to generate extension icons without external dependencies
├── src/
│   ├── types/
│   │   ├── chat.ts              # Chat message and role definitions (with pageContextTitle)
│   │   ├── gemma.ts             # Gemma 4 configuration and hardware report types
│   │   ├── pageReader.ts        # Extracted content, result, error categories, and status types
│   │   └── webgpu.d.ts          # WebGPU TypeScript ambient declarations
│   ├── services/
│   │   ├── gemmaService.ts      # WebLLM engine singleton managing Gemma 4 E2B IT
│   │   └── pageReaderService.ts # Active-tab DOM extraction and permission safety checks
│   ├── components/
│   │   ├── Header.tsx           # Clean header with clear conversation and settings toggle
│   │   ├── PageReaderCard.tsx   # "Read this page" card, preview drawer, and quick actions
│   │   ├── ConversationArea.tsx # Message stream and friendly empty welcome state
│   │   ├── ChatMessageBubble.tsx# Clean chat bubbles with page reference tags
│   │   ├── PromptInput.tsx      # Instruction textarea with unloaded-model helper & privacy badge
│   │   └── SettingsPanel.tsx    # Settings drawer with model controls, sliders & diagnostics
│   ├── styles/
│   │   └── index.css            # Light theme design system & narrow side-panel styles
│   ├── background.ts            # Service worker configuring side panel behavior
│   ├── App.tsx                  # Main side panel container component
│   └── main.tsx                 # React entry point
├── sidepanel.html               # Native Side Panel HTML entry point
├── package.json                 # Project dependencies and build scripts
├── tsconfig.json                # TypeScript compiler configuration
├── tsconfig.node.json           # TypeScript config for Vite
└── vite.config.ts               # Vite multi-entry configuration for extension output
```

---

## Permissions

| Permission | Purpose | Why Requested |
| :--- | :--- | :--- |
| `sidePanel` | Chrome Side Panel API | Hosts Private Pilot natively alongside web browsing without covering page content. |
| `tabs` | Active tab URL & title resolution | Resolves `tab.url`, `tab.pendingUrl`, and `tab.title` from the active tab without requiring broad `<all_urls>` host permissions. |
| `activeTab` | Temporary active-tab host access | Grants Private Pilot execution rights on the currently active webpage when the user explicitly clicks "Read this page". |
| `scripting` | `chrome.scripting.executeScript` | Injects the clean DOM text extraction and safe form filling functions into the active tab. |
| `storage` | `chrome.storage.local` | Privately persists the user's personal profile on-device without cloud sync or external servers. |

### Local File (`file://`) Access
To analyze or assist with forms on local files (e.g. `file:///.../sample-form.html`):
1. Open **`chrome://extensions`** in Google Chrome.
2. Find the **Private Pilot** card and click **Details**.
3. Toggle on **"Allow access to file URLs"**.
If this setting is turned off and you click "Read this page" or "Assist with Form" on a `file://` page, Private Pilot gracefully displays this instruction.

---

## Installation & Build Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Extension
```bash
npm run build
```

This runs:
1. `prebuild`: generates extension icons in `public/icons/`.
2. `tsc`: type checks the TypeScript source code.
3. `vite build`: bundles the React side panel application, background service worker, and copies static assets into `dist/`.

---

## How to Test in Google Chrome

1. Open **Google Chrome** and navigate to `chrome://extensions`.
2. Ensure **Developer mode** (top-right toggle) is enabled.
3. Click **Reload** on the **Private Pilot** card (or click **Load unpacked** and select `c:\Users\tauki\Desktop\PrivatePilot\dist`).
4. Open any webpage in Chrome (e.g. `https://example.com/` or any news/article page).
5. Click the Private Pilot toolbar icon to open the native **Side Panel**.
6. **Verify the Clean Main Screen**:
   - The UI is presented in a bright, light theme with a warm background and white card surfaces.
   - The developer dashboard cards have been moved to Settings.
   - Notice the concise header ("Your private browser assistant") and the welcoming empty state ("What can I help you with?").
7. **Test "Read this page"**:
   - In the "Current Webpage" card, click **"Read this page"**.
   - Notice the button displays *"Reading page…"*.
   - Once extracted, the card shows the page title, domain, word count, and a text preview. Click *"Show preview"* / *"Hide preview"* to toggle the text view.
8. **Test "Explain Simply"**:
   - Notice that the **"Explain Simply"** button appears inside the card once page text is ready.
   - If Gemma 4 is unloaded, clicking **"Explain Simply"** displays a helpful notification asking you to load Gemma 4 first and opens Settings. (It does not auto-load the model).
9. **Test Settings & Model Controls**:
   - In **Settings**, click **"Load Gemma 4 E2B IT"** to load the model on demand.
   - Expand the **"Advanced Diagnostics & Hardware"** accordion to inspect WebGPU compatibility and buffer limits.
   - Adjust the Context Window or Answer Length controls as desired.
   - Click the `✕` button to return to chat.
10. **Test Local "Explain Simply" Inference**:
    - With Gemma 4 ready and page content loaded, click **"Explain Simply"**.
    - Notice the button transitions to *"Explaining page…"*.
    - Observe the streaming response in the chat bubble structured with **Summary**, **Key Points**, and **Difficult Terms Explained** in clear everyday language, strictly grounded in the webpage text.
    - You can also click **"Summarize page"** or ask custom follow-up questions in the input box.
11. **Test One-Time Profile Setup (Phase 7)**:
    - Click the **Settings** gear icon in the top header.
    - Click the **"My Profile"** tab.
    - Fill in reusable details:
      - Full name: `Jane Doe`
      - Email: `jane@example.com`
      - Phone: `+1 555-0199`
      - College or Organization: `Stanford University`
      - Course or Job Title: `Computer Science`
      - Street Address: `100 University Ave`
      - City: `Palo Alto`, State: `CA`, Postal Code: `94301`
      - Add a custom field: Label `Portfolio`, Value `https://janedoe.me`
    - Click **"Save Profile"**: notice the instant green confirmation badge. Profile is stored locally in `chrome.storage.local`.
    - Observe the **"Delete Profile"** button with safe confirmation modal.
12. **Test Smart Autofill from My Profile (Phase 7)**:
    - Open any webpage containing form fields (or local test HTML form).
    - Click **"Assist with Form"** in Private Pilot.
    - Click **"Fill from My Profile"**: notice deterministic smart matching instantly populates matching fields without needing to load or run the AI model.
    - Review the proposed mapping: notice each field displays a checkbox, field type badge, and editable text box.
    - Edit or uncheck any fields you wish to skip.
    - Click **"Approve and Fill"**: only checked fields are injected into the active webpage with visual feedback. The form is **never** submitted automatically.
    - Observe the confirmation banner reporting how many fields were filled and how many eligible fields were skipped.
13. **Root Cause Analysis & Fix for Previous "Failed to fill" Issue**:
    - **Issue 1 (Overly aggressive substring check)**: `pin` matched `shipping` ("s-h-i-p-i-n-g"), and `card` matched CSS class names like Bootstrap's `.card-body`, falsely rejecting legitimate form fields at revalidation time. **Fixed** with strict word-boundary regexes (`\b`) and isolating class names from sensitive keyword checks.
    - **Issue 2 (Active-tab permission desynchronization)**: In MV3 side panels, calling `chrome.tabs.get(targetTabId)` when the tab was not active or when the side panel was focused caused `executeScript` to fail with permission errors. **Fixed** with dynamic active-tab resolution and proactive origin permission checks.
    - **Issue 3 (React/SPA state synchronization)**: Setting `.value` without updating React's internal `_valueTracker` or dispatching `blur` caused controlled React and modern SPA forms to revert or reject the injected value. **Fixed** by setting `_valueTracker` and dispatching `input`, `change`, and `blur` events.
