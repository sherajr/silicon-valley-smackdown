// Arena is the default. The original Phaser game remains available as Classic.
if (new URLSearchParams(location.search).get('classic') === '1') {
  void import('./game');
} else {
  void import('./arena/App').then(({ startArena }) => startArena());
}
