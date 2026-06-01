// 复制修复后的逻辑
function resolveCharacterVoice(chars: any[], speaker: string, rawDialogue = '') {
  if (!speaker || /^(旁白|画外音|narrator)$/i.test(speaker)) return { voiceStyle: '', voiceProvider: '' }
  const sorted = [...chars].sort((a, b) => (b.name || '').length - (a.name || '').length)
  const found = sorted.find((char: any) => {
    if (!char.name) return false
    return char.name === speaker
      || speaker.includes(char.name)
      || rawDialogue.includes(`${char.name}的`)
      || rawDialogue.includes(`${char.name}（`)   // 新增
      || rawDialogue.includes(`${char.name}：`)     // 新增
  })
  return { voiceStyle: found?.voiceStyle || '', voiceProvider: found?.voiceProvider || '' }
}

const chars = [
  { name: '左登峰', voiceStyle: 'male-qn-qingse', voiceProvider: 'minimax' },
  { name: '孙爱国', voiceStyle: 'male-qn-badao', voiceProvider: 'minimax' },
  { name: '胡茜', voiceStyle: 'female-yujie', voiceProvider: 'minimax' },
  { name: '保长', voiceStyle: 'male-qn-jingying', voiceProvider: 'minimax' },
]

const dialogue = "左登峰：（慌乱）胡副所长！我以为有贼——\n孙爱国：（暴怒）睁大你的狗眼看看，我是谁！\n胡茜：（尖声）滚出去！\n左登峰：（后退，脸色煞白）我什么都没看见……什么都没看见！"

const speakers = ['左登峰', '孙爱国', '胡茜', '左登峰']
speakers.forEach(speaker => {
  const r = resolveCharacterVoice(chars, speaker, dialogue)
  console.log(`"${speaker}" → voiceStyle="${r.voiceStyle}"`)
})
