// Keep a real native TTY open after printing history. No application redraws:
// any duplicated/missing rows after resize came from the terminal pipeline.
for (let i = 0; i < 70; i++) {
  process.stdout.write(`HISTORY_ROW_${String(i).padStart(3, '0')} ${'abcdefghij'.repeat(8)}\r\n`);
}
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', data => {
  if (data.includes(3)) process.exit(0);
  process.stdout.write(data);
});
