const fs = require('fs');
const path = require('path');

// Ensure the icons directory exists
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)){
    fs.mkdirSync(iconsDir, { recursive: true });
}

// Simple base64 representations of blue/purple clock/calendar icons
// icon16: A small 16x16 pixels PNG icon (blue/purple square with border)
const icon16Base64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkoBAwUqgHZcNoGEbDYBQEAMNEwEDAwEihHpQNo2EYDYNREAAMEwED2oEABkYAEgE+72wAAAAASUVORK5CYII=';

// icon48: A 48x48 pixels PNG icon
const icon48Base64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAXklEQVRoQ+3ZsQ0AIAwEsWf/nZkR2IGBkkrdV/eJqLpmH1DVA4o3oFADihMofQOKEzABmIDiBMwEpCdgJiA9AdMBExCcgJmAfBqYCcgEmIDiBMwEpCdgJiA9ATMBExCbgAHmJAE3k2hRAAAAAElFTkSuQmCC';

// icon128: A 128x128 pixels PNG icon
const icon128Base64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAfklEQVR4Xu3RAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcGugAAEb6M4AAAAAAElFTkSuQmCC';

fs.writeFileSync(path.join(iconsDir, 'icon16.png'), Buffer.from(icon16Base64, 'base64'));
fs.writeFileSync(path.join(iconsDir, 'icon48.png'), Buffer.from(icon48Base64, 'base64'));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), Buffer.from(icon128Base64, 'base64'));

console.log('Icons generated successfully in the icons directory.');
