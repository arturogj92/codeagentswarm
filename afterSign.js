const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Skip notarization in local builds
  if (!process.env.CI) {
    console.log('Skipping notarization - not in CI environment');
    return;
  }

  // Check for required environment variables
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('Skipping notarization - missing Apple credentials');
    console.warn('Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}...`);
  
  try {
    await notarize({
      appBundleId: 'com.codeagentswarm.app',
      appPath: appPath,
      appleId: appleId,
      appleIdPassword: appleIdPassword,
      teamId: teamId
    });
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};