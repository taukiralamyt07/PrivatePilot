import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  retrieveRelevantContext,
  buildChunksFromText,
  isDetailedExplanationRequest
} from '../src/services/pageRetrievalService.ts';
import { ExtractedPageContent } from '../src/types/pageReader.ts';

// Simulated complete Thermodynamics Wikipedia article with structured section chunks
const mockThermodynamicsPage: ExtractedPageContent = {
  title: 'Thermodynamics - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Thermodynamics',
  hostname: 'en.wikipedia.org',
  text: '', // Computed below
  characterCount: 0,
  wordCount: 0,
  extractedAt: Date.now(),
  truncated: false,
  chunks: [
    {
      id: 'chunk-0',
      heading: 'Thermodynamics',
      level: 1,
      text: 'Thermodynamics is a branch of physics that deals with heat, work, and temperature, and their relation to energy, entropy, and the physical properties of matter and radiation. The behavior of these quantities is governed by the four laws of thermodynamics which convey a quantitative description using measurable macroscopic physical quantities.',
      characterCount: 370,
      wordCount: 52
    },
    {
      id: 'chunk-1',
      heading: 'History',
      level: 2,
      text: 'The history of thermodynamics as a scientific discipline generally begins with Otto von Guericke who, in 1650, built and designed the world first vacuum pump. In 1698, Thomas Savery built the first steam engine, followed by Thomas Newcomen in 1712.',
      characterCount: 254,
      wordCount: 39
    },
    {
      id: 'chunk-2',
      heading: 'Zeroth law of thermodynamics',
      level: 2,
      text: 'The zeroth law of thermodynamics states that if two systems are each in thermal equilibrium with a third system, then they are in thermal equilibrium with each other. This law justifies using thermometers as physical devices to measure temperature, establishing temperature as a transitive and fundamental property of physical systems.',
      characterCount: 334,
      wordCount: 49
    },
    {
      id: 'chunk-3',
      heading: 'First law of thermodynamics',
      level: 2,
      text: 'The first law of thermodynamics, also known as the law of conservation of energy, states that the energy of an isolated system must remain constant. In any thermodynamic process, the change in internal energy of a closed system is equal to the amount of heat supplied to the system, minus the amount of work done by the system on its surroundings.',
      characterCount: 351,
      wordCount: 58
    },
    {
      id: 'chunk-4',
      heading: 'Second law of thermodynamics',
      level: 2,
      text: 'The second law of thermodynamics indicates the irreversibility of natural processes, and that the total entropy of an isolated system always increases over time. It implies that heat does not spontaneously flow from a colder body to a hotter body.',
      characterCount: 247,
      wordCount: 39
    },
    {
      id: 'chunk-5',
      heading: 'Third law of thermodynamics',
      level: 2,
      text: 'The third law of thermodynamics states that the entropy of a system approaches a constant minimum value as the temperature approaches absolute zero. For most pure crystalline substances, the entropy at absolute zero is exactly zero.',
      characterCount: 231,
      wordCount: 36
    }
  ]
};

// Populate aggregate text and counts
mockThermodynamicsPage.text = mockThermodynamicsPage.chunks!
  .map((c) => `## ${c.heading}\n\n${c.text}`)
  .join('\n\n');
mockThermodynamicsPage.characterCount = mockThermodynamicsPage.text.length;
mockThermodynamicsPage.wordCount = mockThermodynamicsPage.text.split(/\s+/).filter(Boolean).length;

describe('Page Retrieval Service - Thermodynamics Wikipedia Acceptance Tests', () => {
  it('Problem 1 / Acceptance Test 2 & 3: Retrieves Zeroth Law chunk and explains thermal equilibrium', () => {
    const question = 'Explain the Zeroth Law of Thermodynamics';
    const result = retrieveRelevantContext(mockThermodynamicsPage, question);

    assert.equal(result.hasConfidentMatch, true, 'Must identify confident match');
    assert.equal(
      result.primarySection.toLowerCase().includes('zeroth'),
      true,
      'Must select the Zeroth law section'
    );
    assert.equal(
      result.contextText.includes('thermal equilibrium'),
      true,
      'Context must contain thermal equilibrium'
    );
    assert.equal(
      result.contextText.includes('third system'),
      true,
      'Context must contain relation with third system'
    );
    assert.ok(result.retrievalScore >= 8, 'Retrieval score must exceed confidence threshold');
    assert.ok(result.retrievalTimeMs >= 0, 'Must record valid retrieval time');
  });

  it('Problem 1 / Acceptance Test 4: Retrieves First Law chunk when asked about First Law', () => {
    const question = 'What is the First Law of Thermodynamics and conservation of energy?';
    const result = retrieveRelevantContext(mockThermodynamicsPage, question);

    assert.equal(result.hasConfidentMatch, true);
    assert.equal(
      result.primarySection.toLowerCase().includes('first law'),
      true,
      'Must select First law section'
    );
    assert.equal(
      result.contextText.includes('internal energy') ||
        result.contextText.includes('conservation of energy'),
      true,
      'Context must contain first law principles'
    );
  });

  it('Problem 1 / Acceptance Test 5: Rejects unrelated questions without inventing information', () => {
    const unrelatedQuestions = [
      'Who won the 1994 FIFA World Cup in soccer?',
      'What is the capital city of Australia?',
      'How do I bake a chocolate chip cookie?'
    ];

    for (const q of unrelatedQuestions) {
      const result = retrieveRelevantContext(mockThermodynamicsPage, q);
      assert.equal(
        result.hasConfidentMatch,
        false,
        `Question "${q}" must NOT have a confident match on thermodynamics page`
      );
    }
  });

  it('Problem 2 / Item 5: Accurately classifies detailed vs concise requests', () => {
    assert.equal(isDetailedExplanationRequest('Explain the Zeroth Law in detail'), true);
    assert.equal(isDetailedExplanationRequest('Give a comprehensive breakdown of entropy'), true);
    assert.equal(isDetailedExplanationRequest('Explain step by step how Carnot cycle works'), true);
    assert.equal(isDetailedExplanationRequest('Elaborate thoroughly on the second law'), true);

    // Default questions are concise
    assert.equal(isDetailedExplanationRequest('Explain the Zeroth Law of Thermodynamics'), false);
    assert.equal(isDetailedExplanationRequest('What is heat?'), false);
    assert.equal(isDetailedExplanationRequest('Define temperature'), false);
  });

  it('Fallbacks cleanly to heading chunking when chunks array is not pre-populated', () => {
    const flatPage: ExtractedPageContent = {
      title: 'Thermodynamics Overview',
      url: 'https://example.com/thermo',
      hostname: 'example.com',
      text: `## Overview
Thermodynamics deals with heat and work.

## Zeroth Law
The zeroth law defines thermal equilibrium between systems.

## First Law
The first law is conservation of energy.`,
      characterCount: 180,
      wordCount: 28,
      extractedAt: Date.now(),
      truncated: false
    };

    const result = retrieveRelevantContext(flatPage, 'Tell me about the Zeroth Law');
    assert.equal(result.hasConfidentMatch, true);
    assert.equal(result.primarySection.toLowerCase().includes('zeroth'), true);
    assert.equal(result.contextText.includes('thermal equilibrium'), true);
  });

  it('buildChunksFromText creates correctly bounded chunks preserving headings', () => {
    const rawMarkdown = `# Main Title
Paragraph 1 of main section.

## Section Alpha
Paragraph of alpha.

## Section Beta
Paragraph of beta.`;

    const chunks = buildChunksFromText(rawMarkdown, 'Fallback Title');
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].heading, 'Main Title');
    assert.equal(chunks[1].heading, 'Section Alpha');
    assert.equal(chunks[2].heading, 'Section Beta');
    assert.ok(chunks[1].text.includes('Paragraph of alpha'));
  });
});
