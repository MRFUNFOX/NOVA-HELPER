/** Пословное сравнение двух редакций пункта (LCS) — для подсветки «было/стало». */
export type DiffPart = { s: string; op: 'same' | 'add' | 'del' };

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  // Тексты пунктов короткие (до сотен слов) — квадратичный LCS здесь дешевле любой библиотеки
  if (a.length * b.length > 400_000) return [{ s: before, op: 'del' }, { s: after, op: 'add' }];
  const dp: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffPart[] = [];
  const push = (s: string, op: DiffPart['op']) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.s += s;
    else out.push({ s, op });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(a[i]!, 'same'); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push(a[i]!, 'del'); i++; }
    else { push(b[j]!, 'add'); j++; }
  }
  while (i < a.length) push(a[i++]!, 'del');
  while (j < b.length) push(b[j++]!, 'add');
  return out;
}
