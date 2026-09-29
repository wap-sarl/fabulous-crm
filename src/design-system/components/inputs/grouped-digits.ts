/** Digits shown in groups: `spaceAfter` lists the digit counts a space follows, as in `1 234 567`. */
export function formatGrouped(digits: string, spaceAfter: readonly number[]): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    out += digits[i];
    if (spaceAfter.includes(i + 1) && i + 1 < digits.length) {
      out += ' ';
    }
  }
  return out;
}

/** Where the n-th digit sits in the grouped text, for the caret. */
export function digitIndexToFormattedIndex(n: number, spaceAfter: readonly number[]): number {
  let extra = 0;
  for (const pos of spaceAfter) {
    if (n > pos) extra += 1;
  }
  return n + extra;
}

export function countDigitsBefore(formatted: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) count += 1;
  }
  return count;
}
