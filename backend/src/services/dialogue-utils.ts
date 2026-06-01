const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

export interface DialogueSegment {
  speaker: string
  text: string
  emotion: string
  speed: number
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanText(value: string) {
  return String(value || '')
    .replace(/[（(][^）)]{1,30}[）)]/g, '')
    .replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferEmotion(text: string, context = '') {
  const raw = `${context} ${text}`
  if (/怒吼|怒喝|厉声|吼|骂|滚出去|出来|老子|恼羞|暴怒/.test(raw)) return 'angry'
  if (/呼救|饶了|救命|害怕|惊恐|惊慌|慌乱|颤|别|不要|恐惧/.test(raw)) return 'fearful'
  if (/惊|突然|什么|怎么|竟然|不可能|吓/.test(raw)) return 'surprised'
  if (/哭|哽咽|难过|失落|绝望|叹/.test(raw)) return 'sad'
  if (/低声|自语|压低|小声|喃喃/.test(raw)) return 'neutral'
  return 'neutral'
}

function inferSpeed(text: string, emotion: string) {
  if (emotion === 'fearful' || emotion === 'angry' || emotion === 'surprised') return 1.08
  if (/低声|自语|沉默|叹/.test(text)) return 0.92
  return 1
}

function normalizeSpeaker(raw: string, characterNames: string[]) {
  const speaker = cleanText(raw).replace(/^(旁白|画外音|narrator).*$/i, '旁白')
  if (!speaker) return ''
  const matched = characterNames.find(name => speaker === name || speaker.includes(name))
  return matched || speaker
}

export function parseDialogueSegments(dialogue?: string | null, characterNames: string[] = []): DialogueSegment[] {
  const raw = String(dialogue || '').trim()
  if (!raw || IGNORE_TTS_TEXT.test(raw)) return []

  const names = [...new Set(characterNames.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  const speakerNames = ['旁白', '画外音', 'narrator', ...names]
  const speakerPattern = speakerNames.map(escapeRegExp).join('|')

  if (speakerPattern) {
    const marker = new RegExp(`(${speakerPattern})(?:[（(][^）)]{1,30}[）)])?\\s*[:：]`, 'gi')
    const matches = [...raw.matchAll(marker)]
    if (matches.length) {
      const segments = matches.map((match, index) => {
        const start = (match.index || 0) + match[0].length
        const end = index + 1 < matches.length ? (matches[index + 1].index || raw.length) : raw.length
        const text = cleanText(raw.slice(start, end))
        const speaker = normalizeSpeaker(match[1], names)
        const emotion = inferEmotion(text, `${speaker} ${match[0]}`)
        return { speaker, text, emotion, speed: inferSpeed(text, emotion) }
      }).filter(item => item.text && !IGNORE_TTS_TEXT.test(item.text) && !IGNORE_TTS_SPEAKERS.test(item.speaker))
      if (segments.length) return segments
    }
  }

  const quoteMatches = [...raw.matchAll(/[“"]([^”"]{1,120})[”"]/g)]
  if (quoteMatches.length) {
    return quoteMatches.map((match) => {
      const matchIndex = match.index || 0
      const before = raw.slice(Math.max(0, matchIndex - 40), matchIndex)
      const speaker = normalizeSpeaker(names.find(name => before.includes(name)) || '', names)
      const text = cleanText(match[1])
      const emotion = inferEmotion(text, before)
      return { speaker, text, emotion, speed: inferSpeed(text, emotion) }
    }).filter(item => item.text && !IGNORE_TTS_TEXT.test(item.text))
  }

  const text = cleanText(raw.replace(/^.+?[:：]\s*/, ''))
  if (!text || IGNORE_TTS_TEXT.test(text)) return []
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = normalizeSpeaker(speakerMatch?.[1] || '旁白', names)
  const emotion = inferEmotion(text, speaker)
  return [{ speaker, text, emotion, speed: inferSpeed(text, emotion) }]
}

export function resolveCharacterVoice(chars: any[], speaker: string) {
  if (!speaker || /^(旁白|画外音|narrator)$/i.test(speaker)) return { voiceStyle: '', voiceProvider: '' }
  const sorted = [...chars].sort((a, b) => (b.name || '').length - (a.name || '').length)
  const found = sorted.find((char) => {
    if (!char.name) return false
    return char.name === speaker || speaker.includes(char.name)
  })
  return { voiceStyle: found?.voiceStyle || '', voiceProvider: found?.voiceProvider || '' }
}

export function stringifySubtitleSegments(segments: DialogueSegment[]) {
  return segments.map(item => item.speaker && item.speaker !== '旁白' ? `${item.speaker}：${item.text}` : item.text).join('\n')
}
