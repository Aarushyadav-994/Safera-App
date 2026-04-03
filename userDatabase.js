import AsyncStorage from '@react-native-async-storage/async-storage';

const USERS_STORAGE_KEY = 'safera_users';
const SESSION_STORAGE_KEY = 'safera_active_user';

const normalizeMobile = (mobile) => mobile.replace(/\D/g, '');
const normalizeUsername = (username) => username.trim().toLowerCase();

async function readUsers() {
  const raw = await AsyncStorage.getItem(USERS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await AsyncStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

export async function registerUser({
  username,
  mobile,
  password,
  profileName,
  email,
  emergencyContact1,
  emergencyContact2,
}) {
  const users = await readUsers();
  const normalizedMobile = normalizeMobile(mobile);
  const normalizedUsername = normalizeUsername(username);

  const existingUser = users.find(
    (user) =>
      normalizeMobile(user.mobile) === normalizedMobile ||
      normalizeUsername(user.username) === normalizedUsername
  );

  if (existingUser) {
    throw new Error('An account with that username or mobile number already exists.');
  }

  const newUser = {
    id: `${Date.now()}`,
    username: username.trim(),
    mobile: normalizedMobile,
    password,
    profileName: profileName?.trim() || '',
    email: email?.trim() || '',
    emergencyContact1: normalizeMobile(emergencyContact1 || ''),
    emergencyContact2: normalizeMobile(emergencyContact2 || ''),
    createdAt: new Date().toISOString(),
  };

  const nextUsers = [...users, newUser];
  await writeUsers(nextUsers);
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newUser));

  return newUser;
}

export async function loginUser({ identifier, password }) {
  const users = await readUsers();
  const normalizedIdentifier = identifier.trim().toLowerCase();
  const mobileIdentifier = normalizeMobile(identifier);

  const user = users.find(
    (entry) =>
      normalizeUsername(entry.username) === normalizedIdentifier ||
      normalizeMobile(entry.mobile) === mobileIdentifier
  );

  if (!user || user.password !== password) {
    throw new Error('Invalid username/mobile or password.');
  }

  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
  return user;
}

export async function getActiveUser() {
  const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function logoutUser() {
  await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function updateActiveUserProfile(updates) {
  const activeUser = await getActiveUser();
  if (!activeUser) {
    throw new Error('No active user found.');
  }

  const users = await readUsers();
  const nextUser = {
    ...activeUser,
    ...updates,
    profileName: updates.profileName?.trim() ?? activeUser.profileName ?? '',
    email: updates.email?.trim() ?? activeUser.email ?? '',
    emergencyContact1:
      updates.emergencyContact1 !== undefined
        ? normalizeMobile(updates.emergencyContact1)
        : activeUser.emergencyContact1 ?? '',
    emergencyContact2:
      updates.emergencyContact2 !== undefined
        ? normalizeMobile(updates.emergencyContact2)
        : activeUser.emergencyContact2 ?? '',
  };

  const nextUsers = users.map((user) => (user.id === activeUser.id ? nextUser : user));
  await writeUsers(nextUsers);
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextUser));

  return nextUser;
}

export async function deleteAccount(userId) {
  const users = await readUsers();
  const filtered = users.filter((u) => u.id !== userId);
  await writeUsers(filtered);
  await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
}

