import dotenv from 'dotenv';
dotenv.config();

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

/**
 * Perform live web search using DeepSeek's Web Search Tool API
 * Endpoint: POST /v1/tools/search
 */
export async function searchWeb(query, count = 5, apiKey = null) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required for web search');
  }

  // DeepSeek search tool requires query to be 1-128 characters
  let cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    throw new Error('Search query is empty');
  }
  if (cleanQuery.length > 120) {
    cleanQuery = cleanQuery.substring(0, 120);
  }

  const endpoint = `${DEEPSEEK_BASE_URL}/v1/tools/search`;
  const payload = {
    query: cleanQuery,
    count: Math.min(Math.max(1, count), 20),
    need_content: true
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek Search API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawResults = data.results || [];

  return rawResults.map(item => ({
    title: item.title || 'Untitled Source',
    url: item.url || '',
    snippet: item.snippet || item.summary || '',
    summary: item.summary || '',
    rerank_score: item.rerank_score || 0
  }));
}

/**
 * Fetch a webpage content as markdown using DeepSeek's Fetch Tool API
 * Endpoint: POST /v1/tools/fetch
 */
export async function fetchWebPage(url, apiKey = null) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required for web fetch');
  }

  const endpoint = `${DEEPSEEK_BASE_URL}/v1/tools/fetch`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek Fetch API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.content || data.markdown || '';
}

/**
 * Formulate automatic research query from topic and regional context
 */
export function formulateSearchQuery(topic, region) {
  const cleanTopic = (topic || '').trim();
  const cleanRegion = (region || '').trim();

  let query = cleanTopic;
  if (cleanRegion && !cleanTopic.toLowerCase().includes(cleanRegion.toLowerCase())) {
    query = `${cleanTopic} ${cleanRegion} Igbo`;
  } else if (!cleanTopic.toLowerCase().includes('igbo')) {
    query = `${cleanTopic} Igbo history culture`;
  }

  // Ensure query is within 120 chars
  return query.substring(0, 120).trim();
}

/**
 * Generate 4 distinct SEO-optimized titles targeting Google search intent and high CTR
 */
export async function generateSeoTitles({
  topic = '',
  currentTitle = '',
  region = '',
  contentSnippet = '',
  apiKey = null
}) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required to optimize titles');
  }

  const subject = (currentTitle && currentTitle !== 'Untitled Draft') ? currentTitle : topic;
  if (!subject || !subject.trim()) {
    throw new Error('Please enter a Topic or Title to optimize');
  }

  const prompt = `You are a premier SEO strategist and digital publication editor for igboatlas.com.
Generate 4 distinct, high-performing article titles for this subject:

SUBJECT / TOPIC: "${subject.trim()}"
${region ? `GEOGRAPHIC / DIALECT REGION: "${region.trim()}"\n` : ''}${contentSnippet ? `CONTENT CONTEXT: "${contentSnippet.substring(0, 400).trim()}..."\n` : ''}
STRICT SEO & EDITORIAL GUIDELINES:
1. CHARACTER LENGTH: Each title MUST be between 40 and 60 characters total (ideal Google SERP pixel width so it NEVER cuts off with ellipses).
2. KEYWORD FRONT-LOADING: Place the highest-volume search keyword as close to the beginning as naturally possible.
3. NO CLICKBAIT CLICHES: Never use cheap clickbait ("You won't believe", "Shocking truth"). Keep it culturally authentic, smart, and published-grade.
4. STRICTLY NO EMOJIS: Do not use any emoji characters or special symbols like ✨.
5. FORMULATE EXACTLY 4 CATEGORIES:
   - "Search Volume": Direct, keyword-first title for standard Google search intent.
   - "High-CTR Hook": Intriguing narrative headline that compels clicks on social / feeds.
   - "Question / Snippet": Search query question targeting Google's "People Also Ask" box.
   - "Definitive Guide": Authoritative cultural guide framing for igboatlas.com.

OUTPUT FORMAT:
Return ONLY a valid JSON array of 4 objects with keys: "category", "title", "charCount", and "rationale".
Do NOT include markdown formatting or backticks around the JSON.`;

  const endpoint = `${DEEPSEEK_BASE_URL}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are an expert SEO copywriter and cultural editor. Return only valid raw JSON arrays without backticks or markdown wrap.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.6,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek Chat API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = (data.choices && data.choices[0]?.message?.content) || '';

  try {
    const cleanJson = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    const titles = JSON.parse(cleanJson);
    return titles.map(t => ({
      category: t.category || 'SEO Optimized',
      title: (t.title || '').replace(/^["']|["']$/g, '').trim(),
      charCount: (t.title || '').length,
      rationale: t.rationale || ''
    }));
  } catch (err) {
    console.warn('Failed to parse titles JSON, using fallback regex:', err.message);
    // Fallback: extract lines
    const lines = rawText.split('\n').filter(l => l.trim().length > 10 && !l.includes('[') && !l.includes(']'));
    return lines.slice(0, 4).map((line, idx) => {
      const clean = line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').replace(/^["']|["']$/g, '').trim();
      return {
        category: ['Search Volume', 'High-CTR Hook', 'Question / Snippet', 'Definitive Guide'][idx] || 'Optimized',
        title: clean,
        charCount: clean.length,
        rationale: 'Optimized for search rankings and clarity.'
      };
    });
  }
}

/**
 * Transform a basic image idea or topic into an intensely descriptive, museum-grade, photorealistic Flux prompt
 * Designed specifically to avoid generic AI faces, inject tangible material culture, and support pure artifact macro options
 */
export async function enhanceImagePrompt({
  prompt = '',
  topic = '',
  region = '',
  style = 'auto', // 'artifact' | 'portrait' | 'landscape' | 'artisan' | 'auto'
  apiKey = null
}) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required to enhance image prompt');
  }

  const cleanSubject = (prompt || topic || '').trim();
  if (!cleanSubject) {
    throw new Error('Please provide an image prompt or article topic to enhance');
  }

  let styleDirective = '';
  if (style === 'artifact') {
    styleDirective = `TARGET VISUAL STYLE: PURE MUSEUM ARTIFACT MACRO (ZERO HUMAN BEINGS, ZERO HUMAN FACES).
Focus 100% on the physical sacred relic/carving/object: aged Iroko wood grain, deep hand-carved chisel grooves, traces of white kaolin (nzu) powder or red camwood (uhie) in the crevices, aged libation stains, cowrie shells, resting on an ancestral earthen shrine altar, single warm ray of morning light filtering through a carved window shutter. NO people, NO human faces.`;
  } else if (style === 'portrait') {
    styleDirective = `TARGET VISUAL STYLE: AUTHENTIC LIVING PORTRAIT (HIGH HUMAN DIVERSITY, ANTI-PLASTIC AI FACES).
AVOID GENERIC SMOOTH SYMMETRICAL AI MODEL FACES. Specify a real, culturally grounded person: exact age (e.g. 72-year-old Ozo titled elder, or 68-year-old priestess), distinctive facial anatomy with deep smile lines, weathered dark melanin skin with authentic pores and natural skin sheen. Off-axis candid gaze (looking down at ritual hands, looking toward side window, NOT staring directly into camera). Authentic regalia: red woolen fez with single white eagle feather (ugo), cylindrical coral beads (ejigija), handwoven Akwete shoulder cloth.`;
  } else if (style === 'landscape') {
    styleDirective = `TARGET VISUAL STYLE: SACRED ARCHITECTURE & LANDSCAPE (ZERO HUMAN FACES).
A vast, atmospheric environmental scene: ancient red mud compound (obi) courtyard, carved Iroko wooden doorway pillars, sacred grove (Ohia Alusi), ancient coiled tree roots, rising morning river mist, damp terracotta soil, dramatic atmospheric perspective. NO human faces.`;
  } else if (style === 'artisan') {
    styleDirective = `TARGET VISUAL STYLE: ARTISAN IN ACTION (CANDID CRAFTSMANSHIP).
A master craftsman (woodcarver, blacksmith, or weaver) focused intently on work. Show hands in motion holding traditional iron adze (otu) or chisel, wood curls and shavings on ground, sawdust on forearms, dynamic side-angle lighting, candid documentary focus.`;
  } else {
    styleDirective = `TARGET VISUAL STYLE: CINEMATIC DOCUMENTARY (HYPER-DETAILED & AUTHENTIC).
If depicting an object or shrine, focus heavily on tangible textures and museum macro detail (prefer zero human faces if topic is an artifact). If depicting a person, anchor specific age, authentic weathered skin, candid action, and traditional Igbo regalia. Avoid generic AI faces completely.`;
  }

  const systemPrompt = `You are an award-winning documentary photographer and cinematic prompt director for National Geographic and premier African art publications.
Your job is to rewrite raw image ideas into hyper-descriptive, photographic prompts for the FLUX.1 image generator.

CRITICAL RULES FOR FLUX PROMPTS:
1. BAN GENERIC AI FACES: When humans are present, specify exact age (e.g. 71-year-old), weathered skin textures, realistic melanin tones, and off-axis candid gaze. Never describe a generic smiling person staring at the lens.
2. MATERIAL AUTHENTICITY: Name authentic Igbo materials (seasoned Iroko wood, Akwete weave, coral beads, eagle feathers, white kaolin chalk nzu, red camwood uhie, carved ivory tusks).
3. CINEMATOGRAPHY: Specify camera gear (e.g., 35mm Leica M6 with 50mm f/1.4 lens, or Hasselblad 500C 80mm f/2.8), rich directional lighting (morning golden hour, chiaroscuro doorway sidelight), shallow depth of field, and natural film grain.
4. PROMPT LENGTH: Exactly 60 to 90 words.
5. NO TEXT: Must strictly end with "strictly NO text, NO letters, NO watermarks, 35mm photography, natural skin pores, 4k resolution".

Return ONLY valid JSON with keys:
{
  "enhancedPrompt": "<The full, rich 60-90 word descriptive prompt for Flux>",
  "category": "artifact | portrait | landscape | artisan",
  "cameraSpecs": "<Camera and lens used>"
}
Do NOT include markdown backticks around JSON.`;

  const userPrompt = `ORIGINAL SUBJECT / PROMPT: "${cleanSubject}"
ARTICLE TOPIC CONTEXT: "${topic || cleanSubject}"
REGION: "${region || 'Igboland, Nigeria'}"
${styleDirective}`;

  const endpoint = `${DEEPSEEK_BASE_URL}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek Prompt Enhancement error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawText = (data.choices && data.choices[0]?.message?.content) || '';
  try {
    const cleanJson = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleanJson);
    return {
      enhancedPrompt: parsed.enhancedPrompt || cleanSubject,
      category: parsed.category || style,
      cameraSpecs: parsed.cameraSpecs || '35mm, f/1.8'
    };
  } catch (err) {
    console.warn('[EnhancePrompt] Failed to parse JSON, falling back:', err.message);
    return {
      enhancedPrompt: rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim(),
      category: style,
      cameraSpecs: '35mm photography'
    };
  }
}

/**
 * Generate full long-form article using DeepSeek Chat Completion (deepseek-flash)
 */
export async function generateArticleDraft({
  topic,
  region = '',
  customAngle = '',
  outline = [],
  includeSummary = true,
  includeReferences = true,
  searchResults = [],
  minWords = 1500,
  model = null,
  apiKey = null
}) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required to generate article');
  }

  const cleanTopic = (topic || '').trim();
  if (!cleanTopic) {
    throw new Error('Article topic is required');
  }

  // Format custom outline directives if provided
  let outlineDirective = '';
  if (Array.isArray(outline) && outline.length > 0) {
    const validSections = outline.filter(s => s && s.title && s.title.trim());
    if (validSections.length > 0) {
      outlineDirective = `USER-SPECIFIED OUTLINE STRUCTURE (MUST FOLLOW THESE SECTION HEADINGS):\n`;
      validSections.forEach((s, idx) => {
        outlineDirective += `## ${idx + 1}. ${s.title.trim()}\n`;
        if (s.subheadings && Array.isArray(s.subheadings)) {
          s.subheadings.filter(Boolean).forEach(sub => {
            outlineDirective += `   - Sub-topic / H3: ${sub.trim()}\n`;
          });
        }
      });
      outlineDirective += `\nINSTRUCTION: Seamlessly construct the article following this specific section structure while maintaining rich narrative depth, historical facts, and analytical pointers.\n\n---\n`;
    }
  }

  // Format research citations into prompt context
  let researchContext = '';
  if (Array.isArray(searchResults) && searchResults.length > 0) {
    researchContext = `LIVE WEB RESEARCH CITATIONS & HISTORICAL CONTEXT:\n`;
    searchResults.forEach((r, idx) => {
      researchContext += `[${idx + 1}] Title: ${r.title}\n`;
      researchContext += `    URL: ${r.url}\n`;
      if (r.snippet) researchContext += `    Snippet: ${r.snippet}\n`;
      if (r.summary && r.summary !== r.snippet) researchContext += `    Summary: ${r.summary}\n`;
      researchContext += '\n';
    });
    researchContext += `INSTRUCTION ON RESEARCH CITATIONS:\n- Cross-reference these verified live web research findings into the article's narrative and historical citations.\n- Actively cite and verify authentic town lineages, deities, customs, or historical accounts.\n\n---\n`;
  }

  // Executive summary block directive
  let summarySectionDirective = '';
  if (includeSummary) {
    summarySectionDirective = `EXECUTIVE SUMMARY DIRECTIVE (STRICTLY CONCISE):
Generate a separate, concise Executive Summary block at the very top of your output.
- LENGTH: STRICT MAXIMUM OF 75 TO 100 WORDS TOTAL. Do not write a long essay or multi-paragraph summary. Keep it punchy, immediate, and direct.
- FORMAT: Wrap this concise block exactly between <<<EXECUTIVE_SUMMARY>>> and <<<END_EXECUTIVE_SUMMARY>>> tags:
<<<EXECUTIVE_SUMMARY>>>
Core Premise: [1-2 concise sentences capturing the overarching cultural or socio-philosophical argument. Max 35 words.]

Key Strategic Takeaways:
- [Takeaway 1: Short, direct cultural or historical takeaway]
- [Takeaway 2: Short analytical nuance or argument]
- [Takeaway 3: Practical insight or contemporary relevance]
<<<END_EXECUTIVE_SUMMARY>>>

`;
  }

  // References block directive
  let referencesDirective = '';
  if (includeReferences) {
    referencesDirective = `## References & Works Cited

### Primary & Contemporary Sources
* [List relevant verified links from the research results provided above with title and brief analytical context]

### External Historical & Academic References
* **[Author / Scholar / Historical Record]** ([Year/Period if known]). *[Title of Work, Treaty, or Ethnographic Archive]*.
  - *Contextual Relevance:* [How this external scholarly source documents or verifies the customs, oral histories, or proverbs analyzed in this piece. Actively cite recognized scholars like Adiele Afigbo, Chinua Achebe, Elizabeth Isichei, K. Onwuka Dike, or local community archives.]
`;
  }

  const targetWords = Math.max(600, parseInt(minWords) || 1500);
  const minThematicSections = Math.max(4, Math.ceil(targetWords / 350));
  const wordsPerSection = Math.round((targetWords * 0.88) / minThematicSections);

  // Build dynamic default sections guide when no outline is provided
  let defaultSectionsStructure = '';
  for (let i = 1; i <= minThematicSections; i++) {
    defaultSectionsStructure += `## [Thematic Section ${i}: Distinct Engaging Title Exploring an Aspect of ${cleanTopic}]
[In-depth multi-paragraph narrative analysis (~${wordsPerSection} words) investigating origins, rituals, philosophy, oral history, or lived practice.]
[Integrate nuanced ethnographic distinctions, dialect variances, or archival evidence organically into the prose, or conclude with a varied contextual callout such as *Ritual Nuance:*, *Dialect Note:*, *Archival Record:*, or *Philosophical Paradox:* — DO NOT repeat the same label across sections.]

`;
  }

  const prompt = `You are an insightful cultural essayist, investigative historian, and domain researcher writing for igboatlas.com (the digital authority on Igbo history, civilization, towns, Odinani, and philosophy).

TOPIC: ${cleanTopic}
${region ? `TARGET REGION / DIALECT: ${region}\n` : ''}${customAngle ? `EDITORIAL DIRECTIVE & ANGLE: ${customAngle}\n` : ''}---
${researchContext}${outlineDirective}MANDATORY ARTICLE LENGTH & DEPTH DIRECTIVE:
- TARGET PROSE LENGTH: The core narrative body of this article (excluding executive summary, key terms, and references) MUST CONTAIN AT LEAST ${targetWords} WORDS of rich, published-grade prose.
- MANDATORY SECTION DENSITY:
  1. To achieve ${targetWords} words naturally without repetitive fluff, you MUST develop AT LEAST ${minThematicSections} major thematic sections (H2 headings), with approximately ${wordsPerSection} words per section across 3 to 5 multi-paragraph deep explorations.
  2. Ground your points in specific regional clans, dialects, or historical traditions (e.g. Nsukka, Owerri, Anioma, Arochukwu, Ngwa, Igbo-Ukwu, Onitsha).
  3. Thoroughly explore philosophical principles (such as cosmic dualism, Chi, Ala, moral reciprocity, ancestral balance).
  4. Break down 2-3 authentic Igbo proverbs (*Ilu*) with literal and metaphorical interpretations.
  5. DO NOT summarize prematurely or rush to the conclusion. Develop each section to its full cultural and scholarly potential.

CRITICAL ZERO-DUPLICATION & CONSISTENCY RULES:
- STRICT ZERO DUPLICATION OF QUOTES & ANECDOTES: Never repeat the same quotation, historical anecdote, museum specimen, or scholar's statement across different sections. Each quote, case study, or archival citation must appear in ONE section only. Subsequent sections must introduce fresh evidence, different ethnographic accounts, or distinct regional testimonies.
- PROGRESSIVE NARRATIVE MOMENTUM: Each section must advance the core argument and build on the revelation of the preceding section. Do not 'reset' the narrative or re-introduce basic definitions in later sections.
- NO FORMULAIC SECTION ENDINGS & UNIQUE CALLOUTS: DO NOT stamp an identical template like "* **Analytical Pointer**:" at the end of every section. Instead, weave analytical takeaways directly into your concluding prose paragraphs, or vary callout framing dynamically (e.g. "* Ethnographic Distinction:", "* Dialect Nuance:", "* Archival Record:", "* Philosophical Paradox:"). If callout labels are used, EACH LABEL MUST BE STRICTLY UNIQUE across the entire article—never reuse the same label twice.
- TOPIC-SPECIFIC PROVERBS: Select authentic Igbo proverbs (*Ilu*) that directly target the specific topic domain (e.g. judicial/customary proverbs for governance and Omenala; agricultural proverbs for yam/farming; martial/strength proverbs for warriors/Ikenga; metaphysical proverbs for Odinani/Chi). Avoid recycling the same generic proverbs across different subjects.
- COMPLETE SACRED & HISTORICAL LIFECYCLE: For articles concerning sacred artifacts, institutions, or rituals, ensure the narrative examines the full cultural lifecycle:
  1. Material selection, carving, and ritual consecration (*Ịkụ aka na mmụọ*).
  2. Active domestic veneration, personal agency, and moral reciprocity (*Chi na Ikenga*).
  3. Terminal post-mortem rites or de-consecration (e.g., *Igbaji Ikenga* — ritual splitting/deposition at the owner's death before burial).
  4. Modern historical transitions: colonial looting, 20th-century missionary and Pentecostal crusade iconoclasm (bonfire burnings), through to contemporary diasporic reclamation and museum restitution debates.

STANDARD ỌNWỤ ORTHOGRAPHY & LINGUISTIC AUTHENTICITY:
- Consistently use standard Ọnwụ Igbo orthography with proper sub-dots (*ọ, ụ, ị, ṅ*) throughout the entire article (e.g., *Ọfọ*, not *Ofo*; *Alụsị*, not *Alusi*; *Ọjị* / *Iroko*, never colonial phonetic corruptions like *uroko*; *Chi*, never colonial *Tshi*).
- Maintain uniform spelling of terms and names across all sections.
- Treat Igbo deities, sacred groves, masquerades (*Mmanwụ*), title systems (*Ọzọ*, *Nze*), and oral traditions with deep ethnographic respect and historical authority.

VOICE & TONE GUIDELINES (SOUND HUMAN & ENGAGING):
- WRITE LIKE A REAL HUMAN BEING: Adopt the voice of an articulate, engaging culture essayist or longform journalist (think Substack, The Atlantic, or premier cultural journals).
- ESSAYISTIC THIRD-PERSON RIGOR: Maintain an authoritative, engaging perspective in the third person or inclusive lens ('we', 'the reader', 'one'). NEVER slip into singular first-person meta-reflections like "What strikes me most", "As I sit with this material", or "In my view" (especially in the Final Reflections).
- DO NOT BE OVERLY STIFF OR ROBOTIC: Speak naturally to the reader. Be approachable, sharp, culturally grounded, and conversational without dumbing down the ideas.
- STRICTLY BAN ALL AI CLICHES: Never use corporate or robotic AI filler phrases. Specifically avoid: "delve", "tapestry", "in conclusion", "it is important to remember", "testament to", "beacon of hope", "realm of", "rich heritage", "pivotal role", "let us examine", "in summary".
- VARY SENTENCE CADENCE: Use a natural mix of short, punchy statements and descriptive flowing thoughts.
- STRICTLY NO EMOJIS: Do not use any emoji characters or symbols anywhere in the article.

ABSOLUTE REQUIREMENT FOR FINAL SECTIONS (NEVER SKIP OR TRUNCATE):
Every single generated article MUST conclude with these exact three final sections before <<<END_ARTICLE_BODY>>>:
1. "## Key Terms & Cultural Concepts": Break down 3-5 specific Igbo terms, proverbs, or cultural phrases examined in the article with tone marks, literal translations, and philosophical context.
2. "## Final Reflections": A thought-provoking, multi-paragraph synthesis leaving the reader with memorable cultural insight. Written in an authoritative, objective essayist voice. Never begin with "In conclusion" or first-person personal commentary ("What strikes me").
${includeReferences ? '3. "## References & Works Cited": Real primary source citations from the research results and recognized scholarly literature.\nFailure to include Final Reflections and References renders the article incomplete.' : ''}

REQUIRED OUTPUT STRUCTURE:
${summarySectionDirective}<<<ARTICLE_BODY>>>
# [Captivating, Human Article Headline focused on ${cleanTopic}]

[Engaging Narrative Lead: Set the scene, introduce the core story or cultural puzzle, and hook the reader naturally without corporate preamble.]

${outlineDirective ? `[Follow the user-specified outline sections above. Under each section heading, write at least ${Math.round(targetWords / Math.max(1, outline.length))} words across multiple deep subsections (H3s) and rich paragraphs with organic analytical insights.]` : defaultSectionsStructure}
## Key Terms & Cultural Concepts
[Explain specific Igbo concepts, proverbs, or cultural phrases examined in the article, with standard spelling, literal translation, and cultural context.]
* **[Term / Expression]**: [Explanation and practical meaning in context.]

## Final Reflections
[A natural, thought-provoking concluding reflection of 2-3 paragraphs that leaves the reader with deep insight. Do not start with "In conclusion" or summarize mechanically.]

${referencesDirective}<<<END_ARTICLE_BODY>>>

<<<IMAGE_PROMPTS>>>
[
  {
    "type": "cover",
    "caption": "Hero Cultural Scene",
    "prompt": "Cinematic wide-angle 35mm documentary photograph of [a wide, atmospheric environmental ritual or sacred gathering setting in ${region || 'Igboland'} related to ${cleanTopic}], golden hour volumetric warm lighting casting long shadows across red clay ground, tactile dust motes, authentic woven textures, Hasselblad 500C, 80mm lens, f/2.8, Kodachrome film grain, strictly NO text, NO watermarks, NO CGI, 4k resolution"
  },
  {
    "type": "artifact",
    "caption": "Sacred Museum Macro (Zero Human Faces)",
    "prompt": "Museum-grade tactile macro photograph of [the authentic antique carved wooden artifact or sacred ritual emblem of ${cleanTopic}], carved from ancient seasoned Iroko hardwood. Extreme close-up showing deep hand-chiselled cuts, aged dark patina, dried white kaolin (nzu) powder and red camwood (uhie) in crevices, cowrie shells, resting on a weathered earthen altar in an obi. Sidelit by a warm shaft of morning window light, 85mm f/2.0 lens, shallow depth of field, strictly NO human beings, NO faces, NO text, 4k photorealism"
  },
  {
    "type": "portrait",
    "caption": "Authentic Living Portrait (High Diversity)",
    "prompt": "Candid documentary environmental portrait of [a specific 68-year-old or 74-year-old Igbo titled elder or priestess, describing unique weathered facial features, deep smile lines, natural dark melanin skin with authentic pores and subtle sheen, off-axis contemplative gaze looking away from camera], wearing authentic red chieftain cap with single white eagle feather (ugo) and cylindrical coral beads (ejigija), seated inside a sun-dappled compound in ${region || 'Ala Igbo'}. Leica M6, 50mm f/1.4, natural daylight, strictly NO generic AI faces, NO text"
  },
  {
    "type": "landscape",
    "caption": "Sacred Compound & Grove (Zero Human Faces)",
    "prompt": "Atmospheric cinematic landscape of [an ancient Igbo red mud compound (obi) courtyard, carved Iroko entrance posts, or sacred grove (Ohia Alusi) with massive moss-covered tree roots], soft morning mist drifting through tropical vegetation, wet terracotta pathways, deep green foliage, 28mm wide lens, soft overcast lighting, strictly NO human faces, NO text, 4k"
  }
]
<<<END_IMAGE_PROMPTS>>>`;

  const endpoint = `${DEEPSEEK_BASE_URL}/chat/completions`;
  // Use requested model, environment default, or deepseek-flash
  const selectedModel = model || process.env.DEEPSEEK_MODEL || 'deepseek-flash';

  // Scale token budget to allow both extensive reasoning and full 3000+ words output without truncation
  const tokenBudget = Math.min(65536, Math.max(20000, Math.ceil(targetWords * 10)));

  console.log(`[DeepSeekWriter] Requesting draft (${targetWords} words, ${minThematicSections} sections, model: ${selectedModel}, max_tokens: ${tokenBudget})...`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cleanKey}`
    },
    body: JSON.stringify({
      model: selectedModel,
      messages: [
        {
          role: 'system',
          content: 'You are an authoritative Igbo cultural historian, researcher, and essayist for igboatlas.com. You write published-grade, full-length articles that sound completely human, deeply researched, and never use AI clichés or emojis. You ALWAYS write out the complete article with rich depth across all sections, including Key Terms, Final Reflections, and References.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: tokenBudget
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek Chat API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  if (!choice) {
    throw new Error('DeepSeek returned an empty choices array');
  }

  let rawContent = (choice.message && choice.message.content) || '';
  let reasoningContent = (choice.message && choice.message.reasoning_content) || '';

  // If content was empty but reasoning had text, fallback
  if (!rawContent.trim() && reasoningContent.trim()) {
    console.log('[DeepSeek] Notice: Model returned output in reasoning_content');
    rawContent = reasoningContent;
  }

  // Automatic continuation check: if generation hit token limit or ended prematurely
  const isTruncated = choice.finish_reason === 'length' ||
    (!rawContent.includes('<<<END_ARTICLE_BODY>>>') && !rawContent.includes('## Final Reflections'));

  if (isTruncated && rawContent.trim()) {
    console.log(`[DeepSeek] Notice: Output truncated or incomplete (finish_reason: ${choice.finish_reason}). Initiating automatic continuation...`);
    try {
      const continuationPrompt = `You were writing the longform essay above for igboatlas.com, but reached the generation token limit. You paused at:
"...${rawContent.slice(-160).trim()}"

INSTRUCTIONS FOR SEAMLESS CONTINUATION:
1. Seamlessly continue writing from the exact word/point where you stopped.
2. DO NOT restart the article, apologize, or repeat previous sentences.
3. Complete the current section in full, then write any remaining thematic sections needed to reach the full ${targetWords}-word target.
4. Conclude with:
   ## Key Terms & Cultural Concepts
   ## Final Reflections
   ${includeReferences ? '## References & Works Cited\n' : ''}<<<END_ARTICLE_BODY>>>
   and the <<<IMAGE_PROMPTS>>> block.`;

      const contResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an authoritative Igbo cultural historian for igboatlas.com. Continue the essay seamlessly without repeating or introducing.'
            },
            {
              role: 'user',
              content: prompt
            },
            {
              role: 'assistant',
              content: rawContent
            },
            {
              role: 'user',
              content: continuationPrompt
            }
          ],
          temperature: 0.5,
          max_tokens: Math.min(32768, Math.max(12000, targetWords * 6))
        })
      });

      if (contResponse.ok) {
        const contData = await contResponse.json();
        const contChoice = contData.choices && contData.choices[0];
        const continuationText = (contChoice?.message?.content) || '';
        if (continuationText.trim()) {
          console.log(`[DeepSeek] Successfully retrieved continuation (${continuationText.length} chars). Stitching output...`);
          rawContent += (rawContent.endsWith(' ') || continuationText.startsWith(' ') ? '' : ' ') + continuationText.trim();
          if (contChoice?.message?.reasoning_content) {
            reasoningContent += '\n\n--- Continuation Reasoning ---\n' + contChoice.message.reasoning_content;
          }
        }
      }
    } catch (contErr) {
      console.warn('[DeepSeek] Continuation error (using initial content):', contErr.message);
    }
  }

  // Parse sections
  let { summary, articleBody, imagePrompts } = extractDraftSections(rawContent);
  articleBody = articleBody || rawContent;

  // Clean trailing punctuation before appending any safety nets if truncated
  const ensureTrailingPeriod = (str) => {
    const trimmed = str.trim();
    if (!trimmed.match(/[\.\!\?\n]$/)) {
      return trimmed + '...';
    }
    return trimmed;
  };

  // Safety net: Ensure ## Key Terms & Cultural Concepts is always present
  if (!articleBody.includes('## Key Terms') && !articleBody.includes('Cultural Concepts')) {
    articleBody = ensureTrailingPeriod(articleBody);
    const keyTermsBlock = `\n\n## Key Terms & Cultural Concepts\n* **Ọdịnala / Omenala**: The sacred ancestral ground, custom, and cosmic order governing community existence.\n* **Ọfọ na Ogu**: The sacred staves and philosophical principle of cosmic justice, truth, and moral integrity.\n* **Ụwa na Ala Mmụọ**: The interconnected reality linking the visible world (*Ụwa*) with the ancestral sanctuary (*Ala Mmụọ*).`;
    if (articleBody.includes('## Final Reflections')) {
      articleBody = articleBody.replace('## Final Reflections', keyTermsBlock + '\n\n## Final Reflections');
    } else {
      articleBody += keyTermsBlock;
    }
  }

  // Safety net: Ensure ## Final Reflections is always present
  if (!articleBody.includes('## Final Reflections')) {
    articleBody = ensureTrailingPeriod(articleBody);
    const reflections = `\n\n## Final Reflections\nExamining the cultural and philosophical dimensions of ${cleanTopic} highlights how indigenous Igbo systems interwove spiritual reverence with social ethics. The living memory of these traditions continues to illuminate contemporary questions of identity, community governance, and moral balance across Ala Igbo.`;
    if (articleBody.includes('## References & Works Cited')) {
      articleBody = articleBody.replace('## References & Works Cited', reflections + '\n\n## References & Works Cited');
    } else {
      articleBody += reflections;
    }
  }

  // Safety net: Ensure ## References & Works Cited is always present if requested
  if (includeReferences && !articleBody.includes('## References & Works Cited')) {
    articleBody = ensureTrailingPeriod(articleBody);
    let refsBlock = '\n\n## References & Works Cited\n\n### Primary & Contemporary Sources\n';
    if (Array.isArray(searchResults) && searchResults.length > 0) {
      searchResults.forEach((r, i) => {
        const cleanSnippet = (r.snippet || r.summary || '').replace(/[\r\n]+/g, ' ').substring(0, 110);
        refsBlock += `* [${i + 1}] **[${r.title}](${r.url})**\n  - *Context:* ${cleanSnippet}...\n`;
      });
    } else {
      refsBlock += '* [1] **IgboAtlas Heritage & Oral Archive** - [Visit Archive](https://igboatlas.com)\n';
    }
    refsBlock += '\n### External Historical & Academic References\n';
    refsBlock += '* **Afigbo, Adiele E.** (1981). *Ropes of Sand: Studies in Igbo History and Culture*. Oxford University Press.\n  - *Contextual Relevance:* Fundamental scholarly documentation of Igbo lineage structures, migration traditions, and pre-colonial governance.\n';
    refsBlock += '* **Isichei, Elizabeth** (1976). *A History of the Igbo People*. London: Macmillan.\n  - *Contextual Relevance:* Historical analysis of traditional spiritual institutions, craft guilds, and oral historical synthesis.\n';
    refsBlock += '* **Achebe, Chinua** (1958). *Things Fall Apart*. London: Heinemann.\n  - *Contextual Relevance:* Literary and ethnographic exploration of ancestral titles, cosmological balance, and community festivals.\n';
    
    articleBody += refsBlock;
  }

  return {
    rawContent,
    summary,
    articleBody,
    imagePrompts,
    reasoningContent
  };
}

/**
 * Split DeepSeek output into Executive Summary, Article Body, and Image Prompts
 */
export function extractDraftSections(rawOutput) {
  const raw = (rawOutput || '').trim();
  if (!raw) {
    return { summary: '', articleBody: '', imagePrompts: [] };
  }

  let summary = '';
  let articleBody = raw;
  let imagePrompts = [];

  // 1. Extract Executive Summary
  if (raw.includes('<<<EXECUTIVE_SUMMARY>>>')) {
    const reSummary = /<<<EXECUTIVE_SUMMARY>>>([\s\S]*?)<<<END_EXECUTIVE_SUMMARY>>>/;
    const m = raw.match(reSummary);
    if (m && m[1]) {
      summary = m[1].trim();
    }
  }

  // 2. Extract Article Body
  if (raw.includes('<<<ARTICLE_BODY>>>')) {
    const reArticle = /<<<ARTICLE_BODY>>>([\s\S]*?)(?:<<<END_ARTICLE_BODY>>>|$)/;
    const m = raw.match(reArticle);
    if (m && m[1]) {
      articleBody = m[1].trim();
    }
  } else if (raw.includes('<<<END_EXECUTIVE_SUMMARY>>>')) {
    const endSummaryIdx = raw.indexOf('<<<END_EXECUTIVE_SUMMARY>>>');
    articleBody = raw.substring(endSummaryIdx + '<<<END_EXECUTIVE_SUMMARY>>>'.length).trim();
  }

  // 3. Extract Image Prompts
  if (raw.includes('<<<IMAGE_PROMPTS>>>')) {
    const rePrompts = /<<<IMAGE_PROMPTS>>>([\s\S]*?)<<<END_IMAGE_PROMPTS>>>/;
    const m = raw.match(rePrompts);
    if (m && m[1]) {
      try {
        const cleanedJson = m[1].trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
        imagePrompts = JSON.parse(cleanedJson);
      } catch (err) {
        console.warn('Failed to parse image prompts JSON:', err.message);
      }
    }
    // Clean prompts block out of articleBody if it was captured inside
    articleBody = articleBody.replace(/<<<IMAGE_PROMPTS>>>[\s\S]*?<<<END_IMAGE_PROMPTS>>>/g, '').trim();
  }

  // Clean tags if any remain
  articleBody = articleBody.replace(/<<<ARTICLE_BODY>>>/g, '').replace(/<<<END_ARTICLE_BODY>>>/g, '').trim();

  // If somehow empty, fallback to raw
  if (!articleBody.trim()) {
    articleBody = raw;
  }

  return { summary, articleBody, imagePrompts };
}

/**
 * Classify a batch of titles into cultural folders using DeepSeek AI
 * @param {Object} options
 * @param {Array<{id: number, title: string, topic?: string, region?: string}>} options.titles
 * @param {Array<{id: number, name: string, description: string}>} options.folders
 * @param {string} [options.apiKey]
 * @returns {Promise<Array<{id: number, folder_id: number, folder_name: string, confidence: string}>>}
 */
export async function classifyTitlesIntoFolders({ titles = [], folders = [], apiKey = null }) {
  const cleanKey = (apiKey || process.env.DEEPSEEK_API_KEY || '').trim();
  if (!cleanKey) {
    throw new Error('DeepSeek API key is required to classify titles');
  }

  if (!titles || titles.length === 0) return [];
  if (!folders || folders.length === 0) return [];

  const BATCH_SIZE = 35;
  const results = [];

  const folderDescriptions = folders.map(f => `- ID ${f.id}: "${f.name}" (${f.description || ''})`).join('\n');
  const validFolderIds = new Set(folders.map(f => Number(f.id)));

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const titlesText = chunk.map(t => `- ID ${t.id}: "${t.title}"${t.region ? ` [Region: ${t.region}]` : ''}`).join('\n');

    const prompt = `You are a distinguished Igbo cultural taxonomist and editorial director for igboatlas.com.
Your task is to classify each of the following article titles into the single most fitting folder ID from the list.

AVAILABLE TARGET FOLDERS:
${folderDescriptions}

TITLES TO CLASSIFY:
${titlesText}

CLASSIFICATION GUIDELINES:
1. Match each title to the folder that best reflects its central theme.
2. If a title is about towns, sacred hills, rivers, landscapes, or settlements, classify into "Places & Geography".
3. If it is about deities, Chi, Alusi, spirits, reincarnation, death rituals, taboos, or spirituality, choose "Cosmology & Deities" or "Beliefs & Spirituality".
4. If it is about agriculture, yams, cuisine, or fermentation, choose "Food".
5. If it is about market systems (Eke, Orie, Afo, Nkwo), apprentice schemes (Igba Boi), trade, choose "Economy & Livelihood".
6. If it is about proverbs, oral poetry, art, or mythology, choose "Arts & Literature".
7. If it is about masquerades, title taking (Ozo), festivals, or social customs, choose "Culture & Traditions".
8. Assign EVERY title to one valid folder ID from the provided folder list.

OUTPUT FORMAT:
Return strictly a valid JSON array of objects.
[{"id": <titleId>, "folder_id": <folderId>, "folder_name": "<name>", "confidence": "high"}]
Do NOT wrap with markdown, backticks, or explanatory text.`;

    const endpoint = `${DEEPSEEK_BASE_URL}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are an expert cultural taxonomist. Return only valid raw JSON arrays without backticks or markdown wrap.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek Classification API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const rawText = (data.choices && data.choices[0]?.message?.content) || '';
    const cleanJson = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');

    try {
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && validFolderIds.has(Number(item.folder_id))) {
            const matchedFolder = folders.find(f => Number(f.id) === Number(item.folder_id));
            results.push({
              id: Number(item.id),
              folder_id: Number(item.folder_id),
              folder_name: matchedFolder ? matchedFolder.name : item.folder_name,
              confidence: item.confidence || 'high'
            });
          }
        }
      }
    } catch (parseErr) {
      console.error('[DeepSeek Classification] Failed to parse batch JSON:', parseErr.message, 'Raw:', rawText);
    }
  }

  return results;
}
