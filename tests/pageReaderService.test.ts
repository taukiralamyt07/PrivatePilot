import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_PAGE_CHARS,
  checkUrlSupport,
  clearPageCache,
  getCachedPage,
  extractPageContentInTab
} from '../src/services/pageReaderService.ts';

describe('Page Reader Service - Configuration & Restrictions', () => {
  it('Problem 1 / Item 4: DEFAULT_MAX_PAGE_CHARS is set to 120,000 to eliminate the 288-word bottleneck', () => {
    assert.ok(
      DEFAULT_MAX_PAGE_CHARS >= 100000,
      `DEFAULT_MAX_PAGE_CHARS must be at least 100,000 chars (current: ${DEFAULT_MAX_PAGE_CHARS})`
    );
    assert.notEqual(
      DEFAULT_MAX_PAGE_CHARS,
      2000,
      'Old 2,000 character (288 word) bottleneck must be removed'
    );
  });

  it('Restricted URLs: Safely blocks chrome:// and browser internal pages', async () => {
    const internalUrls = [
      'chrome://extensions',
      'chrome://settings',
      'chrome-extension://abcdefg/popup.html',
      'about:blank',
      'edge://settings'
    ];

    for (const url of internalUrls) {
      const check = await checkUrlSupport(url);
      assert.equal(check.supported, false, `URL "${url}" should be blocked`);
      assert.ok(check.reason && check.reason.length > 5);
    }
  });

  it('Restricted URLs: Safely blocks Chrome Web Store', async () => {
    const webStoreUrl = 'https://chromewebstore.google.com/detail/private-pilot/12345';
    const check = await checkUrlSupport(webStoreUrl);
    assert.equal(check.supported, false);
    assert.ok(check.reason?.includes('Web Store'));
  });

  it('Supported URLs: Allows standard HTTP and HTTPS websites', async () => {
    const standardUrls = [
      'https://en.wikipedia.org/wiki/Thermodynamics',
      'https://github.com',
      'http://localhost:5173/article.html'
    ];

    for (const url of standardUrls) {
      const check = await checkUrlSupport(url);
      assert.equal(check.supported, true, `URL "${url}" should be supported`);
    }
  });

  it('Page Cache: clearPageCache correctly purges cached content', () => {
    clearPageCache();
    assert.equal(getCachedPage(), null);
  });
});

describe('Page Reader Service - In-Tab Extraction Simulation', () => {
  // Setup a minimal browser-like DOM environment for testing extraction logic
  beforeEach(() => {
    // Reset global document & window mocks
    const mockElements: Record<string, any> = {};

    globalThis.window = {
      location: {
        href: 'https://en.wikipedia.org/wiki/Thermodynamics',
        hostname: 'en.wikipedia.org'
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    } as any;

    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1
    } as any;
  });

  it('extractPageContentInTab produces structured chunks and preserves heading context', () => {
    // Construct mock DOM tree representing Wikipedia Thermodynamics page
    class MockElement {
      tagName: string;
      id: string;
      className: string;
      textContent: string;
      childNodes: any[];
      attributes: Record<string, string>;

      constructor(tagName: string, textContent = '', className = '', id = '') {
        this.tagName = tagName.toUpperCase();
        this.textContent = textContent;
        this.className = className;
        this.id = id;
        this.childNodes = [];
        this.attributes = {};
      }

      hasAttribute(attr: string) {
        return attr in this.attributes;
      }

      getAttribute(attr: string) {
        return this.attributes[attr] || null;
      }

      setAttribute(attr: string, val: string) {
        this.attributes[attr] = val;
      }

      querySelectorAll(selector: string): any[] {
        const results: any[] = [];
        function search(el: MockElement) {
          for (const ch of el.childNodes) {
            if (ch.nodeType === 1) {
              if (selector === ':scope > li' && ch.tagName === 'LI') {
                results.push(ch);
              } else if (selector === 'tr' && ch.tagName === 'TR') {
                results.push(ch);
              } else if ((selector === 'th, td' || selector === 'td') && (ch.tagName === 'TH' || ch.tagName === 'TD')) {
                results.push(ch);
              } else if (selector.includes('mw-editsection') && ch.className.includes('mw-editsection')) {
                results.push(ch);
              }
              search(ch);
            }
          }
        }
        search(this);
        return results;
      }

      cloneNode(deep = true) {
        const clone = new MockElement(this.tagName, this.textContent, this.className, this.id);
        clone.attributes = { ...this.attributes };
        return clone;
      }

      remove() {
        // no-op for mock
      }

      get nodeType() {
        return 1;
      }
    }

    class MockTextNode {
      textContent: string;
      nodeType = 3;
      constructor(text: string) {
        this.textContent = text;
      }
    }

    // Build article with H1, H2, P, and lists
    const mainArticle = new MockElement('DIV', '', 'mw-parser-output', 'mw-content-text');

    const h1 = new MockElement('H1', 'Thermodynamics');
    const p1 = new MockElement(
      'P',
      'Thermodynamics is a branch of physics that deals with heat, work, and temperature, and their relation to energy, entropy, and the physical properties of matter and radiation.'
    );

    const h2Zeroth = new MockElement('H2', 'Zeroth law of thermodynamics');
    const pZeroth = new MockElement(
      'P',
      'The zeroth law of thermodynamics states that if two systems are each in thermal equilibrium with a third system, then they are in thermal equilibrium with each other. This establishes temperature as a fundamental measurable property.'
    );

    const h2First = new MockElement('H2', 'First law of thermodynamics');
    const pFirst = new MockElement(
      'P',
      'The first law of thermodynamics states that energy cannot be created or destroyed, only transformed from one form into another. The internal energy change equals heat added minus work done.'
    );

    // Noisy navigation element that must be excluded
    const nav = new MockElement('NAV', 'Home | Categories | Contact us', 'sidebar');
    const script = new MockElement('SCRIPT', 'console.log("analytics")');

    mainArticle.childNodes = [h1, p1, h2Zeroth, pZeroth, h2First, pFirst, nav, script];

    globalThis.document = {
      title: 'Thermodynamics - Wikipedia',
      querySelector: (selector: string) => {
        if (selector === '#mw-content-text' || selector === '.mw-parser-output') {
          return mainArticle;
        }
        return null;
      },
      body: mainArticle
    } as any;

    const result = extractPageContentInTab(120000);

    assert.equal(result.title, 'Thermodynamics - Wikipedia');
    assert.equal(result.hostname, 'en.wikipedia.org');
    assert.equal(result.truncated, false, 'Article must not be truncated');
    assert.ok(result.wordCount > 50, `Word count must exceed 50 words (was: ${result.wordCount})`);
    assert.ok(
      result.text.includes('thermal equilibrium'),
      'Extracted text must contain thermal equilibrium'
    );
    assert.ok(
      result.text.includes('first law of thermodynamics') ||
        result.text.includes('First law of thermodynamics'),
      'Extracted text must contain first law'
    );
    // Verify noisy elements were excluded
    assert.equal(
      result.text.includes('Home | Categories'),
      false,
      'Navigation sidebar must be excluded'
    );
    assert.equal(
      result.text.includes('analytics'),
      false,
      'Script elements must be excluded'
    );

    // Verify section chunks were constructed
    assert.ok(result.chunks.length >= 2, 'Must construct structured chunks for sections');
    const zerothChunk = result.chunks.find((c) =>
      c.heading.toLowerCase().includes('zeroth')
    );
    assert.ok(zerothChunk, 'Must have a chunk dedicated to Zeroth law');
    assert.ok(zerothChunk!.text.includes('thermal equilibrium'));
  });
});
