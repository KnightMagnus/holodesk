// Populates the preview with a sample conversation and a speaking core.
// Dev only: excluded from packaged builds.
export async function run({ comms, media, core }) {
  comms.say('user', "What's my CPU temperature, and how's the weather looking?");
  comms.say('ai', "Your Ryzen is at a comfortable 57 degrees under light load. Outside it's 54 and partly cloudy, with rain likely tomorrow.");
  comms.say('user', 'Find me a synthwave mix.');
  comms.say('ai', 'Pulled up a few synthwave feeds in the media panel.');
  document.querySelector('#yt-query').value = 'synthwave mix';
  await media.search('synthwave mix');
  document.querySelectorAll('.yt .th').forEach((el, i) => {
    el.style.background = `linear-gradient(${120 + i * 40}deg, hsl(${190 + i * 8} 90% 30%), hsl(${215 + i * 6} 80% 12%))`;
    el.querySelector('img')?.remove();
  });
  core.setState('speaking');
  core.setLevelSource((now) => ({ level: 0.35 + Math.abs(Math.sin(now / 110)) * 0.45, spectrum: null }));
  document.getElementById('state-text').textContent = 'HOLODESK';
  document.getElementById('state-hint').textContent = 'TRANSMITTING · ESC TO STOP';
}
