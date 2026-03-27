import AsyncStorage from '@react-native-async-storage/async-storage';

const COMPLETED_TRIPS_PREFIX = 'safera_completed_trips';
const TRIP_REPORTS_PREFIX = 'safera_trip_reports';

const getCompletedTripsKey = (userId) => `${COMPLETED_TRIPS_PREFIX}_${userId}`;
const getTripReportsKey = (userId) => `${TRIP_REPORTS_PREFIX}_${userId}`;

const safeParseArray = (rawValue) => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export async function getCompletedTrips(userId) {
  if (!userId) {
    return [];
  }

  const raw = await AsyncStorage.getItem(getCompletedTripsKey(userId));
  return safeParseArray(raw);
}

export async function saveCompletedTrip(userId, trip) {
  if (!userId || !trip) {
    return [];
  }

  const existingTrips = await getCompletedTrips(userId);
  const nextTrips = [trip, ...existingTrips].slice(0, 20);
  await AsyncStorage.setItem(getCompletedTripsKey(userId), JSON.stringify(nextTrips));
  return nextTrips;
}

export async function getTripReports(userId) {
  if (!userId) {
    return [];
  }

  const raw = await AsyncStorage.getItem(getTripReportsKey(userId));
  return safeParseArray(raw);
}

export async function saveTripReport(userId, report) {
  if (!userId || !report) {
    return [];
  }

  const existingReports = await getTripReports(userId);
  const nextReports = [report, ...existingReports];
  await AsyncStorage.setItem(getTripReportsKey(userId), JSON.stringify(nextReports));
  return nextReports;
}

export async function replaceTripReports(userId, reports) {
  if (!userId) {
    return [];
  }

  const nextReports = Array.isArray(reports) ? reports : [];
  await AsyncStorage.setItem(getTripReportsKey(userId), JSON.stringify(nextReports));
  return nextReports;
}

export async function clearTripHistory(userId) {
  if (!userId) {
    return;
  }

  await AsyncStorage.setItem(getCompletedTripsKey(userId), JSON.stringify([]));
}
