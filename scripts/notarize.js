const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Solo notarizar en CI (GitHub Actions)
  if (!process.env.CI) {
    console.log('Skipping notarization - not in CI');
    return;
  }

  // Solo notarizar si tenemos las credenciales
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('Skipping notarization - missing credentials');
    console.log('APPLE_ID present:', !!process.env.APPLE_ID);
    console.log('APPLE_ID_PASSWORD present:', !!process.env.APPLE_ID_PASSWORD);
    console.log('APPLE_TEAM_ID present:', !!process.env.APPLE_TEAM_ID);
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log('Notarizing', appPath);
  console.log('Using Apple ID:', process.env.APPLE_ID);
  console.log('Using Team ID:', process.env.APPLE_TEAM_ID);

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    });
    console.log('Notarization complete');
  } catch (error) {
    console.error('Notarization failed:', error);
    console.error('Full error details:', JSON.stringify(error, null, 2));
    throw error;
  }
};