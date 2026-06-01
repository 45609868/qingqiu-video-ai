import { db, schema } from './src/db/index.js'
import { eq } from 'drizzle-orm'
import { parseDialogueSegments, resolveCharacterVoice } from './src/services/dialogue-utils.js'

const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, 4)).all()
console.log('Total chars:', chars.length)
chars.forEach(c => console.log(`  id=${c.id} name=${c.name} voiceStyle=${c.voiceStyle} voiceProvider=${c.voiceProvider}`))

const dialogue = "左登峰：（慌乱）胡副所长！我以为有贼——\n孙爱国：（暴怒）睁大你的狗眼看看，我是谁！\n胡茜：（尖声）滚出去！\n左登峰：（后退，脸色煞白）我什么都没看见……什么都没看见！"
const segments = parseDialogueSegments(dialogue, chars.map(c => c.name))
console.log('\nSegments:', segments.map(s => s.speaker))

segments.forEach(seg => {
  const resolved = resolveCharacterVoice(chars, seg.speaker, dialogue)
  console.log(`Speaker="${seg.speaker}" → voiceStyle="${resolved.voiceStyle}" voiceProvider="${resolved.voiceProvider}"`)
})
