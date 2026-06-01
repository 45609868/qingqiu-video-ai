import { db, schema } from './src/db/index.js'
import { eq } from 'drizzle-orm'
import { parseDialogueSegments, resolveCharacterVoice } from './src/services/dialogue-utils.js'

const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, 4)).all()
const dialogue = "左登峰：（慌乱）胡副所长！我以为有贼——\n孙爱国：（暴怒）睁大你的狗眼看看，我是谁！\n胡茜：（尖声）滚出去！\n左登峰：（后退，脸色煞白）我什么都没看见……什么都没看见！"

// Simulate resolveCharacterVoice for 孙爱国
const speaker = "孙爱国"
const sorted = [...chars].sort((a, b) => (b.name || '').length - (a.name || '').length)
let matchReason = ''

const found = sorted.find((char) => {
  if (!char.name) return false
  const c1 = char.name === speaker
  const c2 = speaker.includes(char.name)
  const c3 = dialogue.includes(`${char.name}的`)
  const c4 = dialogue.includes(char.name)
  if (c1 || c2 || c3 || c4) {
    matchReason = `c1=${c1} c2=${c2} c3=${c3} c4=${c4}`
    console.log(`Match: char="${char.name}" voice="${char.voiceStyle}" reason=${matchReason}`)
  }
  return c1 || c2 || c3 || c4
})

console.log('Result:', found ? `${found.name} → ${found.voiceStyle}` : 'none')
