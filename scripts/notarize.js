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
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.log('Skipping notarization - credentials not found');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log('Notarizing', appPath);

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appBundleId: 'com.codeagentswarm.app',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    });
    console.log('Notarization complete');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};