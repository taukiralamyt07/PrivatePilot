import { ExtractedPageContent, PageReaderResult } from '../types/pageReader';

/**
 * Maximum safe character budget for webpage content extraction.
 * 120,000 characters translates to ~18,000–20,000 words, removing the previous
 * arbitrary 288-word bottleneck and allowing full articles (like Wikipedia Thermodynamics)
 * to be extracted completely without truncation.
 */
export const DEFAULT_MAX_PAGE_CHARS = 120000;

export interface InTabChunk {
  id: string;
  heading: string;
  level: number;
  text: string;
  characterCount: number;
  wordCount: number;
}

/**
 * Self-contained extraction function executed inside the target tab context.
 * IMPORTANT: In Chrome MV3 executeScript func, this function must not reference
 * any variables outside its own scope.
 */
export function extractPageContentInTab(maxChars: number = 120000): {
  title: string;
  url: string;
  hostname: string;
  text: string;
  characterCount: number;
  wordCount: number;
  truncated: boolean;
  chunks: InTabChunk[];
} {
  const title = (document.title || '').trim() || 'Untitled Page';
  const url = window.location.href || '';
  const hostname = window.location.hostname || '';

  // Elements to strictly exclude to ensure clean text, noise reduction, and absolute privacy
  const excludedTags = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'SVG',
    'CANVAS',
    'AUDIO',
    'VIDEO',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'BUTTON',
    'FORM',
    'DIALOG',
    'NAV',
    'HEADER',
    'FOOTER',
    'ASIDE'
  ]);

  function isElementVisibleAndRelevant(el: Element): boolean {
    const tagName = el.tagName.toUpperCase();
    if (excludedTags.has(tagName)) {
      return false;
    }

    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
      return false;
    }

    // Strict privacy exclusion: never inspect password fields or sensitive textboxes
    const typeAttr = (el.getAttribute('type') || '').toLowerCase();
    if (typeAttr === 'password' || typeAttr === 'hidden') {
      return false;
    }

    const roleAttr = (el.getAttribute('role') || '').toLowerCase();
    if (
      roleAttr === 'navigation' ||
      roleAttr === 'banner' ||
      roleAttr === 'contentinfo' ||
      roleAttr === 'complementary' ||
      roleAttr === 'alert' ||
      roleAttr === 'tooltip' ||
      roleAttr === 'dialog'
    ) {
      return false;
    }

    // Exclude noise, edit sections, TOC, sidebars, advertisements, and Wikipedia metadata
    const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    const id = (el.id || '').toLowerCase();

    if (
      className.includes('mw-jump-link') ||
      className.includes('mw-editsection') ||
      className.includes('reflist') ||
      className.includes('navbox') ||
      className.includes('sidebar') ||
      className.includes('noprint') ||
      className.includes('mw-indicators') ||
      className.includes('catlinks') ||
      className.includes('printfooter') ||
      className.includes('vector-menu') ||
      id === 'toc' ||
      className.includes('toc') ||
      id === 'mw-navigation' ||
      id === 'mw-panel' ||
      id === 'footer'
    ) {
      return false;
    }

    // Generic advertisements, cookie notices, and social widgets
    if (
      className.includes('cookie') ||
      className.includes('advert') ||
      className.includes('popup') ||
      className.includes('modal') ||
      className.includes('social-share') ||
      className.includes('share-buttons') ||
      className.includes('breadcrumb')
    ) {
      return false;
    }

    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      ) {
        return false;
      }
    } catch {
      // Fallback if computed style cannot be read
    }

    return true;
  }

  // Identify semantic content root using site-independent priority hierarchy
  const candidateSelectors = [
    'article',
    '[itemprop="articleBody"]',
    '#mw-content-text',      // Wikipedia main article body
    '.mw-parser-output',     // Wikipedia article content container
    'main',
    '[role="main"]',
    '.article-body',
    '.article-content',
    '.entry-content',
    '.post-content',
    '#content',
    '.content'
  ];

  let primaryRoot: Element | null = null;
  for (let i = 0; i < candidateSelectors.length; i++) {
    const el = document.querySelector(candidateSelectors[i]);
    if (el && (el.textContent || '').trim().length > 200) {
      primaryRoot = el;
      break;
    }
  }

  if (!primaryRoot) {
    primaryRoot = document.body;
  }

  if (!primaryRoot) {
    return {
      title,
      url,
      hostname,
      text: '',
      characterCount: 0,
      wordCount: 0,
      truncated: false,
      chunks: []
    };
  }

  // Structured extraction with heading detection and chunk construction
  const chunks: InTabChunk[] = [];
  let currentHeading = title;
  let currentLevel = 1;
  let currentBlocks: string[] = [];
  let currentChunkChars = 0;
  let totalCharsCollected = 0;
  let chunkCounter = 0;
  let reachedCeiling = false;

  function flushChunk() {
    const chunkText = currentBlocks.join('\n\n').trim();
    if (chunkText.length > 0) {
      chunks.push({
        id: `chunk-${chunkCounter++}`,
        heading: currentHeading,
        level: currentLevel,
        text: chunkText,
        characterCount: chunkText.length,
        wordCount: chunkText.split(/\s+/).filter(Boolean).length
      });
      currentBlocks = [];
      currentChunkChars = 0;
    }
  }

  function appendBlock(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 2) return;

    if (totalCharsCollected + clean.length > maxChars) {
      const remaining = maxChars - totalCharsCollected;
      if (remaining > 20) {
        const sliced = clean.substring(0, remaining).trim();
        currentBlocks.push(sliced);
        totalCharsCollected += sliced.length;
      }
      reachedCeiling = true;
      return;
    }

    currentBlocks.push(clean);
    currentChunkChars += clean.length;
    totalCharsCollected += clean.length;

    // Split long section cleanly at paragraph boundary if it exceeds 1200 characters
    if (currentChunkChars >= 1200) {
      flushChunk();
    }
  }

  function walk(node: Node) {
    if (reachedCeiling) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent || '').trim();
      if (txt.length > 2) {
        appendBlock(txt);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    if (!isElementVisibleAndRelevant(el)) {
      return;
    }

    // Headings (H1 to H6)
    if (/^H[1-6]$/.test(tag)) {
      // Clean heading text and remove Wikipedia [edit] tags
      const headingClone = el.cloneNode(true) as Element;
      const editTags = headingClone.querySelectorAll('.mw-editsection, [aria-hidden="true"]');
      for (let j = 0; j < editTags.length; j++) {
        editTags[j].remove();
      }
      const rawHeading = (headingClone.textContent || '').replace(/\s+/g, ' ').trim();

      if (rawHeading.length > 0) {
        // Finalize current chunk before starting new section
        flushChunk();
        currentLevel = parseInt(tag.charAt(1), 10);
        currentHeading = rawHeading;
      }
      return;
    }

    // Lists (UL, OL)
    if (tag === 'UL' || tag === 'OL') {
      const items: string[] = [];
      const liElements = el.querySelectorAll(':scope > li');
      for (let i = 0; i < liElements.length; i++) {
        const liText = (liElements[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (liText.length > 1) {
          items.push(`• ${liText}`);
        }
      }
      if (items.length > 0) {
        appendBlock(items.join('\n'));
      }
      return;
    }

    // Tables (TABLE)
    if (tag === 'TABLE') {
      const rows: string[] = [];
      const trElements = el.querySelectorAll('tr');
      for (let i = 0; i < Math.min(trElements.length, 25); i++) {
        const cells = trElements[i].querySelectorAll('th, td');
        const cellTexts: string[] = [];
        for (let j = 0; j < cells.length; j++) {
          const ct = (cells[j].textContent || '').replace(/\s+/g, ' ').trim();
          if (ct) cellTexts.push(ct);
        }
        if (cellTexts.length > 0) {
          rows.push(cellTexts.join(' | '));
        }
      }
      if (rows.length > 0) {
        appendBlock(rows.join('\n'));
      }
      return;
    }

    // Paragraphs (P) and Blockquotes (BLOCKQUOTE)
    if (tag === 'P' || tag === 'BLOCKQUOTE') {
      const pText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (pText.length > 2) {
        appendBlock(tag === 'BLOCKQUOTE' ? `> ${pText}` : pText);
      }
      return;
    }

    // Default container traversal
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      walk(children[i]);
      if (reachedCeiling) break;
    }
  }

  walk(primaryRoot);

  // If candidate yielded too little content and was not document.body, fallback to document.body
  if (totalCharsCollected < 200 && primaryRoot !== document.body && document.body) {
    chunks.length = 0;
    currentBlocks.length = 0;
    totalCharsCollected = 0;
    reachedCeiling = false;
    walk(document.body);
  }

  // Finalize any remaining blocks
  flushChunk();

  // Reconstruct full formatted text with section headings
  const formattedSections = chunks.map((c) => {
    if (c.level > 1) {
      return `## ${c.heading}\n\n${c.text}`;
    }
    return c.text;
  });

  let combined = formattedSections.join('\n\n\n').trim();
  const truncated = reachedCeiling;

  if (truncated && !combined.endsWith('...')) {
    combined += '...';
  }

  const words = combined ? combined.split(/\s+/).filter(Boolean).length : 0;

  return {
    title,
    url,
    hostname,
    text: combined,
    characterCount: combined.length,
    wordCount: words,
    truncated,
    chunks
  };
}

export const FILE_ACCESS_BLOCKED_MESSAGE =
  'Access to local file URLs (file://) is disabled by Chrome. To enable it, open chrome://extensions → Private Pilot → Details, and turn on "Allow access to file URLs".';

/**
 * Checks whether the extension has been granted permission to access file:// URLs
 * by the user in chrome://extensions -> Details.
 */
export async function isFileSchemeAccessAllowed(): Promise<boolean> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.extension ||
    typeof chrome.extension.isAllowedFileSchemeAccess !== 'function'
  ) {
    return false;
  }
  try {
    return await chrome.extension.isAllowedFileSchemeAccess();
  } catch {
    return false;
  }
}

/**
 * Checks whether a given URL is restricted by Chrome MV3 security policies.
 * Explicitly guards against Chrome internal pages, extensions management, web store, and unpermitted local files.
 */
export async function checkUrlSupport(
  url: string
): Promise<{ supported: boolean; reason?: string; isFileUrlBlocked?: boolean }> {
  const lower = url.toLowerCase();

  // 1. Explicitly check chrome://extensions and internal extension pages
  if (lower.startsWith('chrome://extensions') || lower.includes('chrome://extensions')) {
    return {
      supported: false,
      reason: 'The active tab is the Chrome extensions management page (chrome://extensions), which cannot be scripted. Please switch to a regular webpage.'
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      supported: false,
      reason: 'The active tab is an internal Chrome extension page, which cannot be read. Please switch to a regular webpage.'
    };
  }

  // 2. Check other Chrome / Edge internal schemes
  if (
    lower.startsWith('chrome://') ||
    lower.startsWith('edge://') ||
    lower.startsWith('about:') ||
    lower.startsWith('devtools://') ||
    lower.startsWith('view-source:')
  ) {
    const scheme = lower.split(':')[0];
    return {
      supported: false,
      reason: `Chrome internal page (${scheme}://) is restricted by browser security policies. Please navigate to a standard webpage.`
    };
  }

  // 3. Chrome Web Store restriction
  if (
    lower.includes('chromewebstore.google.com') ||
    lower.includes('chrome.google.com/webstore')
  ) {
    return {
      supported: false,
      reason: 'Google Chrome strictly blocks extensions from reading or scripting Chrome Web Store pages. Please open any standard article or website.'
    };
  }

  // 4. Local file URLs (file://)
  if (lower.startsWith('file://')) {
    const allowed = await isFileSchemeAccessAllowed();
    if (!allowed) {
      return {
        supported: false,
        isFileUrlBlocked: true,
        reason: FILE_ACCESS_BLOCKED_MESSAGE
      };
    }
    return { supported: true };
  }

  // 5. Verify protocol is http or https
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return {
      supported: false,
      reason: 'Only standard HTTP, HTTPS, and local file (file://) webpages can be read by Private Pilot.'
    };
  }

  return { supported: true };
}

/**
 * Queries the active browser tab in the current Chrome window hosting the side panel.
 * Strictly uses { active: true, currentWindow: true } to target the user's active page.
 * Does not fall back silently to other windows or unrelated tabs.
 */
export async function getActiveTabInCurrentWindow(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].id !== undefined) {
      return tabs[0];
    }
  } catch (err) {
    console.warn('[Private Pilot] query active tab in currentWindow failed:', err);
  }

  return null;
}

/**
 * Reads and extracts bounded visible text from the currently active browser tab.
 * Handles absent tab, absent URL, restricted URL, and missing permissions separately
 * with diagnostic error messages.
 */
interface PageCacheEntry {
  tabId: number;
  url: string;
  data: ExtractedPageContent;
  timestamp: number;
}

let activePageCache: PageCacheEntry | null = null;

/**
 * Retrieves the currently cached extracted page content, if any.
 */
export function getCachedPage(): ExtractedPageContent | null {
  return activePageCache ? activePageCache.data : null;
}

/**
 * Invalidates the page extraction cache.
 */
export function clearPageCache(): void {
  activePageCache = null;
}

export type ReadActiveWebpageOptions =
  | number
  | {
      maxChars?: number;
      forceRefresh?: boolean;
    };

/**
 * Reads and extracts visible text and structured chunks from the currently active browser tab.
 * Uses intelligent in-memory caching to avoid repeatedly re-extracting unchanged pages.
 */
export async function readActiveWebpage(
  options?: ReadActiveWebpageOptions
): Promise<PageReaderResult> {
  const maxChars =
    typeof options === 'number'
      ? options
      : options?.maxChars ?? DEFAULT_MAX_PAGE_CHARS;
  const forceRefresh =
    typeof options === 'object' && options !== null
      ? Boolean(options.forceRefresh)
      : false;

  const extractionStartTime = performance.now();

  // Step 1: Verify Chrome MV3 Extension APIs and permissions
  if (
    typeof chrome === 'undefined' ||
    !chrome.tabs ||
    typeof chrome.tabs.query !== 'function' ||
    !chrome.scripting ||
    typeof chrome.scripting.executeScript !== 'function'
  ) {
    return {
      success: false,
      errorCategory: 'MISSING_PERMISSION',
      diagnosticStep: 'PERMISSION_VERIFICATION',
      error: 'Missing required Chrome APIs (chrome.tabs or chrome.scripting). Please verify that "tabs", "activeTab", and "scripting" are declared in manifest.json.'
    };
  }

  // Step 2: Query the active tab in the current Chrome window
  let tab: chrome.tabs.Tab | null = null;
  try {
    tab = await getActiveTabInCurrentWindow();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      errorCategory: 'MISSING_PERMISSION',
      diagnosticStep: 'ACTIVE_TAB_QUERY',
      error: `Failed to query active tab due to permission or runtime error: ${msg}`
    };
  }

  // Handle Absent Tab
  if (!tab || tab.id === undefined) {
    return {
      success: false,
      errorCategory: 'ABSENT_TAB',
      diagnosticStep: 'ACTIVE_TAB_QUERY',
      error: 'No active tab found in the current browser window. Please click on a webpage tab and try again.'
    };
  }

  // Step 3: Inspect active tab URL
  const tabUrl = (tab.url || tab.pendingUrl || '').trim();

  // Handle Absent URL
  if (!tabUrl) {
    return {
      success: false,
      errorCategory: 'ABSENT_URL',
      diagnosticStep: 'URL_ACCESSIBILITY_CHECK',
      error: 'The active tab has no accessible URL (the page may still be loading, uncommitted, or blank). Please wait for the webpage to finish loading and try again.'
    };
  }

  // Step 4: Handle Restricted URLs
  const urlCheck = await checkUrlSupport(tabUrl);
  if (!urlCheck.supported) {
    return {
      success: false,
      isUnsupportedPage: true,
      errorCategory: urlCheck.isFileUrlBlocked ? 'MISSING_PERMISSION' : 'RESTRICTED_URL',
      diagnosticStep: 'URL_RESTRICTION_CHECK',
      unsupportedReason: urlCheck.reason,
      error: urlCheck.reason
    };
  }

  // Check Cache: Return cached result if page has not changed and forceRefresh is not requested
  if (
    !forceRefresh &&
    activePageCache &&
    activePageCache.tabId === tab.id &&
    activePageCache.url === tabUrl
  ) {
    return {
      success: true,
      data: activePageCache.data
    };
  }

  // Step 5: Verify runtime host permission for the active tab's origin
  let originPattern: string | null = null;
  try {
    const parsed = new URL(tabUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      originPattern = `${parsed.origin}/*`;
    }
  } catch {
    // If URL parsing fails, proceed to scripting error handling
  }

  if (
    originPattern &&
    typeof chrome !== 'undefined' &&
    chrome.permissions &&
    typeof chrome.permissions.contains === 'function' &&
    typeof chrome.permissions.request === 'function'
  ) {
    let hasOriginPermission = false;
    try {
      hasOriginPermission = await chrome.permissions.contains({ origins: [originPattern] });
    } catch (permErr) {
      console.warn('[Private Pilot] chrome.permissions.contains check failed:', permErr);
    }

    if (!hasOriginPermission) {
      try {
        const granted = await chrome.permissions.request({ origins: [originPattern] });
        if (!granted) {
          return {
            success: false,
            errorCategory: 'MISSING_PERMISSION',
            diagnosticStep: 'PERMISSION_VERIFICATION',
            error: `Permission to read "${tab.title || tabUrl}" was not granted. Please allow access when prompted to let Private Pilot read the page.`
          };
        }
      } catch (reqErr: unknown) {
        const reqMsg = reqErr instanceof Error ? reqErr.message : String(reqErr);
        console.warn('[Private Pilot] chrome.permissions.request error:', reqMsg);
        return {
          success: false,
          errorCategory: 'MISSING_PERMISSION',
          diagnosticStep: 'PERMISSION_VERIFICATION',
          error: `Permission request failed: ${reqMsg}. Please reload the extension at chrome://extensions and grant permission when prompted.`
        };
      }
    }
  }

  // Step 6: Execute extraction script on the verified accessible active page
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContentInTab,
      args: [maxChars]
    });

    if (!results || results.length === 0 || !results[0].result) {
      return {
        success: false,
        errorCategory: 'EXECUTION_FAILED',
        diagnosticStep: 'SCRIPT_EXECUTION',
        error: `No result returned from script execution on tab (ID: ${tab.id}). The page may still be rendering or uncommitted.`
      };
    }

    const raw = results[0].result as {
      title: string;
      url: string;
      hostname: string;
      text: string;
      characterCount: number;
      wordCount: number;
      truncated: boolean;
      chunks?: InTabChunk[];
    };

    // Step 7: Check for Empty Content
    if (!raw.text || raw.characterCount === 0) {
      return {
        success: false,
        errorCategory: 'EMPTY_CONTENT',
        diagnosticStep: 'CONTENT_PARSING',
        error: 'No accessible visible text was found on this webpage. (The page may contain only images, canvas elements, or require authentication).'
      };
    }

    const isFile = tabUrl.toLowerCase().startsWith('file://');
    let resolvedHostname = raw.hostname;
    if (!resolvedHostname || resolvedHostname === 'Webpage') {
      if (isFile) {
        resolvedHostname = 'Local File';
      } else {
        try {
          resolvedHostname = new URL(tabUrl).hostname || 'Webpage';
        } catch {
          resolvedHostname = 'Webpage';
        }
      }
    }

    const extractionTimeMs = performance.now() - extractionStartTime;

    const data: ExtractedPageContent = {
      title: raw.title || tab.title || (isFile ? 'Local File' : 'Current Webpage'),
      url: raw.url || tabUrl,
      hostname: resolvedHostname,
      text: raw.text,
      characterCount: raw.characterCount,
      wordCount: raw.wordCount,
      extractedAt: Date.now(),
      truncated: raw.truncated,
      chunks: raw.chunks || [],
      extractionTimeMs
    };

    // Cache extracted result
    activePageCache = {
      tabId: tab.id,
      url: tabUrl,
      data,
      timestamp: Date.now()
    };

    // Development diagnostic timing without exposing page content
    console.info(
      `[Private Pilot Diagnostics] Page extracted in ${extractionTimeMs.toFixed(1)}ms: ${data.wordCount.toLocaleString()} words, ${data.chunks?.length || 0} section chunks (${data.hostname})`
    );

    return {
      success: true,
      data
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Provide friendly diagnostic message for blocked local file access
    if (tabUrl.toLowerCase().startsWith('file://')) {
      const allowed = await isFileSchemeAccessAllowed();
      if (!allowed || msg.includes('Cannot access') || msg.includes('permission')) {
        return {
          success: false,
          isUnsupportedPage: true,
          errorCategory: 'MISSING_PERMISSION',
          diagnosticStep: 'SCRIPT_EXECUTION',
          unsupportedReason: FILE_ACCESS_BLOCKED_MESSAGE,
          error: FILE_ACCESS_BLOCKED_MESSAGE
        };
      }
    }

    // Provide friendly diagnostic messages for known Chrome script execution errors
    if (
      msg.includes('Extension manifest must request permission') ||
      msg.includes('Cannot access contents of url') ||
      msg.includes('permission')
    ) {
      return {
        success: false,
        errorCategory: 'MISSING_PERMISSION',
        diagnosticStep: 'SCRIPT_EXECUTION',
        error: `Permission error on tab (ID: ${tab.id}): ${msg}. Please ensure the extension is reloaded at chrome://extensions and grant permission when prompted.`
      };
    }

    if (msg.includes('Cannot access a chrome://') || msg.includes('cannot be scripted')) {
      return {
        success: false,
        isUnsupportedPage: true,
        errorCategory: 'RESTRICTED_URL',
        diagnosticStep: 'SCRIPT_EXECUTION',
        unsupportedReason: 'Chrome security prevents scripting on internal browser pages or protected stores.',
        error: 'Chrome security prevents scripting on internal browser pages or protected stores.'
      };
    }

    if (msg.includes('Frame with ID 0 was removed') || msg.includes('tab was closed')) {
      return {
        success: false,
        errorCategory: 'EXECUTION_FAILED',
        diagnosticStep: 'SCRIPT_EXECUTION',
        error: 'The target tab was closed or reloaded while reading.'
      };
    }

    return {
      success: false,
      errorCategory: 'EXECUTION_FAILED',
      diagnosticStep: 'SCRIPT_EXECUTION',
      error: `Script execution failed on tab (ID: ${tab.id}): ${msg}`
    };
  }
}
