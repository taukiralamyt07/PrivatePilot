import {
  ExtractedPageContent,
  PageSectionChunk,
  PageRetrievalResult
} from '../types/pageReader';

const COMMON_STOP_WORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'explain',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'please',
  's',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  't',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves'
]);

/**
 * Checks whether user query asks for detailed explanation.
 */
export function isDetailedExplanationRequest(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes('detail') ||
    lower.includes('elaborate') ||
    lower.includes('in-depth') ||
    lower.includes('comprehensive') ||
    lower.includes('step by step') ||
    lower.includes('thorough') ||
    lower.includes('full explanation') ||
    lower.includes('explain deeply')
  );
}

/**
 * Splits plain text into structured section chunks if chunks are not already present.
 */
export function buildChunksFromText(
  text: string,
  defaultHeading: string = 'Overview'
): PageSectionChunk[] {
  if (!text || !text.trim()) return [];

  // Match markdown-style headings (# Heading, ## Heading) or split on double newlines
  const lines = text.split('\n');
  const chunks: PageSectionChunk[] = [];
  let currentHeading = defaultHeading;
  let currentLevel = 2;
  let currentBlocks: string[] = [];
  let chunkIndex = 0;

  function finalizeCurrentChunk() {
    const chunkText = currentBlocks.join('\n').trim();
    if (chunkText.length > 0) {
      chunks.push({
        id: `chunk-${chunkIndex++}`,
        heading: currentHeading,
        level: currentLevel,
        text: chunkText,
        characterCount: chunkText.length,
        wordCount: chunkText.split(/\s+/).filter(Boolean).length
      });
      currentBlocks = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      finalizeCurrentChunk();
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
      continue;
    }

    if (trimmed.length > 0) {
      currentBlocks.push(trimmed);
      // If a single chunk without headings exceeds 1400 chars, split cleanly
      if (currentBlocks.join('\n').length > 1400) {
        finalizeCurrentChunk();
      }
    }
  }

  finalizeCurrentChunk();

  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({
      id: 'chunk-0',
      heading: defaultHeading,
      level: 1,
      text: text.trim(),
      characterCount: text.trim().length,
      wordCount: text.trim().split(/\s+/).filter(Boolean).length
    });
  }

  return chunks;
}

/**
 * Extracts normalized query tokens and bigrams.
 */
function extractQueryTerms(query: string): { keywords: string[]; bigrams: string[] } {
  const clean = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .trim();
  const rawWords = clean.split(/\s+/).filter((w) => w.length > 1);

  const keywords: string[] = [];
  for (const w of rawWords) {
    if (!COMMON_STOP_WORDS.has(w)) {
      keywords.push(w);
    }
  }

  const bigrams: string[] = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    const w1 = rawWords[i];
    const w2 = rawWords[i + 1];
    if (!COMMON_STOP_WORDS.has(w1) || !COMMON_STOP_WORDS.has(w2)) {
      bigrams.push(`${w1} ${w2}`);
    }
  }

  return { keywords, bigrams };
}

/**
 * Efficient local keyword retrieval that identifies and prioritizes the most
 * relevant section chunks from extracted page content.
 */
export function retrieveRelevantContext(
  pageContent: ExtractedPageContent,
  query: string,
  maxContextChars: number = 1800
): PageRetrievalResult {
  const startTime = performance.now();

  const chunks =
    pageContent.chunks && pageContent.chunks.length > 0
      ? pageContent.chunks
      : buildChunksFromText(pageContent.text, pageContent.title);

  if (chunks.length === 0) {
    return {
      hasConfidentMatch: false,
      primarySection: 'No Content',
      matchedSections: [],
      contextText: '',
      matchedChunks: [],
      retrievalScore: 0,
      retrievalTimeMs: performance.now() - startTime
    };
  }

  const { keywords, bigrams } = extractQueryTerms(query);

  // If query is very short or has only stop words, fallback to first chunk / overview
  if (keywords.length === 0 && bigrams.length === 0) {
    const firstChunk = chunks[0];
    return {
      hasConfidentMatch: false,
      primarySection: firstChunk.heading,
      matchedSections: [firstChunk.heading],
      contextText: `[Section: ${firstChunk.heading}]\n${firstChunk.text.substring(0, maxContextChars)}`,
      matchedChunks: [firstChunk],
      retrievalScore: 0,
      retrievalTimeMs: performance.now() - startTime
    };
  }

  // Calculate Document Frequency (DF) for each keyword across all chunks
  const totalChunks = chunks.length;
  const docFrequency: Record<string, number> = {};
  for (const kw of keywords) {
    docFrequency[kw] = 0;
  }

  const normalizedChunkData = chunks.map((chunk) => {
    const headingLower = chunk.heading.toLowerCase();
    const textLower = chunk.text.toLowerCase();
    const combinedLower = `${headingLower} ${textLower}`;

    for (const kw of keywords) {
      if (combinedLower.includes(kw)) {
        docFrequency[kw] = (docFrequency[kw] || 0) + 1;
      }
    }

    return { chunk, headingLower, textLower, combinedLower };
  });

  // Calculate IDF for each keyword: higher weight for rarer terms (e.g. "zeroth")
  const idfWeights: Record<string, number> = {};
  for (const kw of keywords) {
    const df = docFrequency[kw] || 0;
    // Smoothed BM25-like IDF
    idfWeights[kw] = Math.log(1 + (totalChunks - df + 0.5) / (df + 0.5));
  }

  // Score each chunk
  const scoredChunks = normalizedChunkData.map(({ chunk, headingLower, textLower }) => {
    let score = 0;

    // 1. Bigram match in heading (e.g. "zeroth law", "thermal equilibrium")
    for (const bg of bigrams) {
      if (headingLower.includes(bg)) {
        score += 30;
      } else if (textLower.includes(bg)) {
        score += 10;
      }
    }

    // 2. Keyword match in heading (heavily boosted)
    for (const kw of keywords) {
      if (headingLower.includes(kw)) {
        const idf = idfWeights[kw] || 1;
        score += 14 * Math.max(1, idf);
      }
    }

    // 3. Keyword matches in chunk text
    let matchedKwCount = 0;
    for (const kw of keywords) {
      if (textLower.includes(kw)) {
        matchedKwCount++;
        const idf = idfWeights[kw] || 1;
        // Count term frequency up to 3 occurrences
        const occurrences = (textLower.match(new RegExp(`\\b${kw}`, 'g')) || []).length;
        const tf = Math.min(3, Math.max(1, occurrences));
        score += tf * (3 * Math.max(1, idf));
      }
    }

    // 4. Multi-keyword co-occurrence bonus (if chunk contains multiple query keywords)
    if (keywords.length > 1 && matchedKwCount > 1) {
      score += matchedKwCount * 5;
    }

    return { chunk, score };
  });

  scoredChunks.sort((a, b) => b.score - a.score);

  const topMatch = scoredChunks[0];
  // A score >= 8 means at least one strong keyword or heading match was found
  const CONFIDENCE_THRESHOLD = 8;
  const hasConfidentMatch = topMatch && topMatch.score >= CONFIDENCE_THRESHOLD;

  const selectedChunks: PageSectionChunk[] = [];
  let totalChars = 0;

  if (topMatch && topMatch.score > 0) {
    selectedChunks.push(topMatch.chunk);
    totalChars += topMatch.chunk.characterCount;

    // Optionally include secondary chunk if strong score and fits context budget
    for (let i = 1; i < scoredChunks.length; i++) {
      const candidate = scoredChunks[i];
      if (
        candidate.score >= CONFIDENCE_THRESHOLD &&
        candidate.score >= topMatch.score * 0.4 &&
        totalChars + candidate.chunk.characterCount <= maxContextChars
      ) {
        selectedChunks.push(candidate.chunk);
        totalChars += candidate.chunk.characterCount;
      }
      if (totalChars >= maxContextChars) break;
    }
  } else {
    // Fallback: if no matches, select first chunk (introductory section)
    selectedChunks.push(chunks[0]);
  }

  // Format context text with section headers
  const contextParts = selectedChunks.map(
    (c) => `[Section: ${c.heading}]\n${c.text}`
  );
  let contextText = contextParts.join('\n\n---\n\n');
  if (contextText.length > maxContextChars) {
    contextText = contextText.substring(0, maxContextChars).trim() + '...';
  }

  const matchedSections = selectedChunks.map((c) => c.heading);
  const primarySection = selectedChunks[0]?.heading || 'Article';

  return {
    hasConfidentMatch,
    primarySection,
    matchedSections,
    contextText,
    matchedChunks: selectedChunks,
    retrievalScore: topMatch?.score || 0,
    retrievalTimeMs: performance.now() - startTime
  };
}
