export const getBackupStatus = async () => {
  return {
    status: 'not_configured',
    message: 'Backup monitoring is not configured yet',
    lastSuccessfulBackup: null,
    nextScheduledBackup: null,
  };
};
