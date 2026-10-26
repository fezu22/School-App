import mongoose from 'mongoose';

export const getSystemHealth = async () => {
  const databaseConnected = mongoose.connection.readyState === 1;

  return {
    api: {
      status: 'healthy',
      message: 'API is running',
    },
    database: {
      status: databaseConnected ? 'healthy' : 'unhealthy',
      message: databaseConnected
        ? 'MongoDB is connected'
        : 'MongoDB is not connected',
    },
    overall: databaseConnected ? 'healthy' : 'unhealthy',
  };
};