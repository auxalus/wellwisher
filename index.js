/**
 * WhatsApp Birthday Notification Bot
 * Stack: Node.js, whatsapp-web.js, qrcode-terminal, node-cron
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { applyNoRead } = require('./noread');

// ==========================================
// CONFIGURATION
// ==========================================

// 1. Paste your college group's WhatsApp serialized ID here.
// Example: '120363023456789012@g.us' or '919876543210-1612345678@g.us'
// Leave as placeholder or run `npm run list-groups` to find your group ID.
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || 'YOUR_COLLEGE_GROUP_ID@g.us';

// 2. Cron schedule expression (Default: '0 0 * * *' = everyday at 00:00 midnight)
// For testing every minute: '* * * * *'
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 0 * * *';

// 3. Optional: Set your timezone for the cron schedule (e.g., 'Asia/Kolkata', 'America/New_York')
// Set to null or empty string to use local system timezone.
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

// Path to the birthdays JSON database
const BIRTHDAYS_FILE_PATH = path.join(__dirname, 'birthdays.json');

// Command line / environment flags
const SHOULD_LIST_GROUPS = process.env.LIST_GROUPS_ONLY === 'true' || process.argv.includes('--list-groups');
const SHOULD_TEST_RUN = process.env.TEST_RUN_NOW === 'true' || process.argv.includes('--test-run');

// ==========================================
// CLIENT INITIALIZATION
// ==========================================

console.log('--------------------------------------------------');
console.log('🤖 Starting WhatsApp Birthday Notification Bot...');
console.log('--------------------------------------------------');

const client = new Client({
    // LocalAuth stores the browser session locally inside .wwebjs_auth
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Activate NoRead write-only protection: suppresses blue ticks (sendSeen), blocks reading conversation text, and preserves unread status
applyNoRead(client);

// ==========================================
// EVENT HANDLERS
// ==========================================

// 1. QR Code Generation for initial linking
client.on('qr', (qr) => {
    console.log('\n📲 Scan this QR code in WhatsApp (Linked Devices > Link a Device):');
    qrcode.generate(qr, { small: true });
    console.log('Waiting for authorization...\n');
});

// 2. Authenticated event
client.on('authenticated', () => {
    console.log('✅ Session authenticated successfully! Session credentials persisted.');
});

// 3. Authentication failure event
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    console.error('💡 Tip: If session is corrupted, delete the .wwebjs_auth folder and re-run to scan QR.');
});

// 4. Ready event - triggers once WhatsApp Web is fully loaded
client.on('ready', async () => {
    console.log('🚀 WhatsApp Web Client is READY!');

    // Check if the user only wanted to list group IDs
    if (SHOULD_LIST_GROUPS) {
        console.log('\n🔍 Running group identification utility...');
        await listActiveGroups(client);
        console.log('\n✅ Group ID extraction finished. Exiting process as requested.');
        await cleanupAndExit(0);
        return;
    }

    // Check if TARGET_GROUP_ID has not been configured yet
    if (!TARGET_GROUP_ID || TARGET_GROUP_ID.includes('YOUR_COLLEGE_GROUP_ID')) {
        console.warn('\n⚠️ WARNING: TARGET_GROUP_ID is still set to placeholder!');
        console.warn('👉 Automatically displaying your active group chats below so you can copy the ID:');
        await listActiveGroups(client);
        console.warn('\n📝 Copy the desired group ID and set it as TARGET_GROUP_ID in index.js, then restart.');
        return;
    }

    console.log(`🎯 Configured Target Group ID: ${TARGET_GROUP_ID}`);

    // If test run flag is passed, execute a check immediately
    if (SHOULD_TEST_RUN) {
        console.log('\n🧪 [Test Mode] Executing an immediate birthday check...');
        await checkAndSendBirthdays();
    }

    // Schedule the daily cron job
    initScheduler();
});

// 5. Connection drop & disconnect handling
client.on('disconnected', async (reason) => {
    console.warn(`⚠️ Client was disconnected! Reason: ${reason}`);
    console.log('🔄 Attempting to re-initialize connection in 10 seconds...');
    try {
        await client.destroy();
    } catch (err) {
        // Ignore destroy error on disconnected client
    }
    setTimeout(() => {
        console.log('🔄 Re-initializing WhatsApp Client...');
        client.initialize().catch((err) => {
            console.error('❌ Failed to re-initialize client:', err.message);
        });
    }, 10000);
});

// Handle unhandled errors to prevent silent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
    await cleanupAndExit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
    await cleanupAndExit(0);
});

async function cleanupAndExit(code = 0) {
    try {
        await client.destroy();
    } catch (e) {
        // Ignore destruction errors
    }
    process.exit(code);
}

// ==========================================
// CORE UTILITIES & FUNCTIONS
// ==========================================

/**
 * Utility Function: Scans and logs all active WhatsApp chats and identifies Group chats with their serialized IDs.
 * Use this to discover your exact college group ID.
 * @param {Client} clientInstance 
 */
async function listActiveGroups(clientInstance) {
    try {
        console.log('\n======================================================');
        console.log('📋 ACTIVE WHATSAPP GROUPS & SERIALIZED IDs');
        console.log('======================================================');
        
        const chats = await clientInstance.getChats();
        const groupChats = chats.filter((c) => c.isGroup);

        if (groupChats.length === 0) {
            console.log('No active group chats found on this WhatsApp account.');
            return;
        }

        console.log(`Found ${groupChats.length} active group(s):\n`);

        groupChats.forEach((group, index) => {
            const groupName = group.name || 'Unnamed Group';
            const groupId = group.id._serialized;
            const unreadCount = group.unreadCount || 0;
            console.log(`${index + 1}. Name: "${groupName}"`);
            console.log(`   Group ID: ${groupId}`);
            console.log(`   Unread Messages: ${unreadCount}`);
            console.log('   ---------------------------------------------------');
        });

        console.log('\n💡 Copy the string next to "Group ID" (e.g. 120363023456789012@g.us)');
        console.log('   and paste it into TARGET_GROUP_ID in index.js');
        console.log('======================================================\n');
    } catch (error) {
        console.error('❌ Error fetching chats:', error.message);
    }
}

/**
 * Reads and verifies the birthdays.json file.
 * Returns an array of validated birthday objects.
 * @returns {Array<Object>}
 */
function loadAndValidateBirthdays() {
    if (!fs.existsSync(BIRTHDAYS_FILE_PATH)) {
        console.error(`❌ Birthdays data file not found at: ${BIRTHDAYS_FILE_PATH}`);
        return [];
    }

    try {
        const rawContent = fs.readFileSync(BIRTHDAYS_FILE_PATH, 'utf-8');
        
        if (!rawContent.trim()) {
            console.warn('⚠️ birthdays.json is empty.');
            return [];
        }

        const data = JSON.parse(rawContent);

        if (!Array.isArray(data)) {
            console.error('❌ Validation error: birthdays.json root element must be a JSON Array of entries.');
            return [];
        }

        const validEntries = [];
        data.forEach((entry, idx) => {
            if (!entry || typeof entry !== 'object') {
                console.warn(`⚠️ Skipping entry at index ${idx}: not a valid object.`);
                return;
            }

            if (!entry.name || typeof entry.name !== 'string' || !entry.name.trim()) {
                console.warn(`⚠️ Skipping entry at index ${idx}: missing or invalid "name".`);
                return;
            }

            if (!entry.dob || typeof entry.dob !== 'string') {
                console.warn(`⚠️ Skipping entry "${entry.name}": missing or invalid "dob" (expected string).`);
                return;
            }

            // Supported formats: "MM-DD" or "YYYY-MM-DD"
            const trimmedDob = entry.dob.trim();
            const dateRegex = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
            if (!dateRegex.test(trimmedDob)) {
                console.warn(`⚠️ Skipping "${entry.name}": Invalid date format for dob "${trimmedDob}". Use "MM-DD" or "YYYY-MM-DD".`);
                return;
            }

            // Extract MM-DD normalized format
            const monthDayMatch = trimmedDob.match(/(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
            const normalizedMonthDay = monthDayMatch ? monthDayMatch[0] : null;

            validEntries.push({
                name: entry.name.trim(),
                dob: trimmedDob,
                monthDay: normalizedMonthDay,
                customMessage: entry.customMessage && typeof entry.customMessage === 'string' ? entry.customMessage.trim() : null
            });
        });

        return validEntries;
    } catch (error) {
        console.error('❌ Failed to read or parse birthdays.json:', error.message);
        return [];
    }
}

/**
 * Helper to build the birthday message for a friend.
 * @param {Object} person 
 * @returns {string}
 */
function createBirthdayGreeting(person) {
    if (person.customMessage) {
        return person.customMessage;
    }

    // Default warm and festive birthday greeting template
    return (
        `🎉🎂 *HAPPY BIRTHDAY, ${person.name.toUpperCase()}!* 🎂🎉\n\n` +
        `Wishing you an extraordinary day filled with laughter, great memories, and endless joy! 🥳🎈\n` +
        `May this upcoming year bring you immense success, good health, and wonderful achievements.\n\n` +
        `Enjoy your special day to the fullest! 🍰🎁✨`
    );
}

/**
 * Checks for any birthdays matching today's date and sends greetings to the target group.
 */
async function checkAndSendBirthdays() {
    console.log(`\n⏰ [${new Date().toLocaleString()}] Checking for birthdays today...`);

    const birthdays = loadAndValidateBirthdays();
    if (birthdays.length === 0) {
        console.log('ℹ️ No valid birthday records found in database.');
        return;
    }

    // Get today's MM-DD in local time
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayMonthDay = `${month}-${day}`;

    console.log(`📅 Today's Date (MM-DD): ${todayMonthDay}`);

    const todaysCelebrants = birthdays.filter((entry) => entry.monthDay === todayMonthDay);

    if (todaysCelebrants.length === 0) {
        console.log('ℹ️ No birthdays today. See you tomorrow!');
        return;
    }

    console.log(`🎉 Found ${todaysCelebrants.length} birthday(s) today! Preparing to send wishes...`);

    for (const person of todaysCelebrants) {
        const message = createBirthdayGreeting(person);

        try {
            console.log(`📤 Sending birthday greeting for ${person.name} to group (${TARGET_GROUP_ID})...`);
            
            await client.sendMessage(TARGET_GROUP_ID, message);
            
            console.log(`✅ Birthday wish successfully sent for: ${person.name}`);
        } catch (error) {
            console.error(`❌ Failed to send birthday wish for ${person.name}:`, error.message);
        }

        // Small 2-second delay between messages if multiple people share the birthday
        if (todaysCelebrants.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}

/**
 * Initializes the node-cron daily automation.
 */
function initScheduler() {
    console.log(`⏳ Scheduling daily birthday check with cron: "${CRON_SCHEDULE}" (Timezone: ${TIMEZONE || 'System Local'})`);

    const cronOptions = TIMEZONE ? { scheduled: true, timezone: TIMEZONE } : { scheduled: true };

    try {
        cron.schedule(CRON_SCHEDULE, async () => {
            console.log(`\n🔔 Cron trigger fired at ${new Date().toLocaleString()}`);
            await checkAndSendBirthdays();
        }, cronOptions);

        console.log('✅ Daily scheduler initialized successfully.');
    } catch (err) {
        console.error('❌ Failed to schedule cron job:', err.message);
    }
}

// ==========================================
// START CLIENT
// ==========================================
client.initialize().catch((err) => {
    console.error('❌ Error during client initialization:', err.message);
});

