import { db, schema } = require('./src/db/index.ts')
import { eq } = require('drizzle-orm')
import { parseDialogueSegments, resolveCharacterVoice } = require('./src/services/dialogue-utils.ts')

// @ts-ignore
const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, 4)).all()

const dialogue = "左登峰：（慌乱）胡副所长！我以为有贼——\n孙爱国：（暴怒）睁大你的狗眼看看，我是谁！\n胡茜：（尖声）滚出去！\n左登峰：（后退，脸色煞白）我什么都没看见……什么都没看见！"

const speaker = "孙爱国"
const sorted = [...chars].sort((a, b) => (b.name || '').length - (a.name || '').length)
console.log('Sorted chars:')
sorted.forEach(c => console.log(`  name="${c.name}" len=${c.name.length} voiceStyle="${c.voiceStyle}"`))

const found = sorted.find((char) => {
  if (!char.name) return false
  const match = char.name === speaker || speaker.includes(char.name) || dialogue.includes(`${char.name}的`) || dialogue.includes(char.name)
  if (match) console.log(`MATCH: char.name="${char.name}" voiceStyle="${char.voiceStyle}"`)
  return match
})
console.log('Found:', found ? found.name + ' -> ' + found.voiceStyle : 'undefined')
