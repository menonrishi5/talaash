// Tiny demo-only pub/sub linking the narrator dock and App's tab state, so the
// guided tour can switch tabs and the dock can follow manual navigation —
// without threading props through the app. Both sides call goToDemoTab() to
// broadcast and subscribe with onDemoTab(); the change guard prevents loops.

const subs = new Set()
let current = 'set-design'

export function currentDemoTab() {
  return current
}

export function goToDemoTab(id) {
  if (id === current) return
  current = id
  subs.forEach((cb) => cb(id))
}

export function onDemoTab(cb) {
  subs.add(cb)
  return () => subs.delete(cb)
}
