/**
 * noread.js
 * 
 * Module to ensure the WhatsApp bot operates strictly in WRITE-ONLY mode:
 * 1. Does not read, log, or process any inbound conversation messages.
 * 2. Never sends read receipts (blue ticks) by disabling sendSeen at Node.js & browser levels.
 * 3. Forces sendSeen: false on all outgoing messages.
 * 4. Preserves unread status/badges on chats after writing to them.
 * 5. Suppresses "online" presence to keep the bot stealthy and offline.
 */

const { Chat } = require('whatsapp-web.js');

// Events that read or process inbound message content
const SENSITIVE_READ_EVENTS = new Set([
    'message',
    'message_create',
    'message_received',
    'message_ciphertext',
    'unread_count'
]);

/**
 * Injects overrides into the Puppeteer page to disable WhatsApp Web's internal sendSeen logic.
 * @param {import('puppeteer').Page} pupPage 
 */
async function injectBrowserProtections(pupPage) {
    if (!pupPage || pupPage.isClosed()) return;

    try {
        await pupPage.evaluate(() => {
            const disableSeen = () => {
                // 1. Override WWebJS wrapper
                if (window.WWebJS && typeof window.WWebJS.sendSeen === 'function') {
                    window.WWebJS.sendSeen = async () => false;
                }

                // 2. Override internal WhatsApp Store SendSeen modules
                if (window.Store) {
                    if (window.Store.SendSeen) {
                        if (typeof window.Store.SendSeen.sendSeen === 'function') {
                            window.Store.SendSeen.sendSeen = async () => false;
                        }
                        if (typeof window.Store.SendSeen.markSeen === 'function') {
                            window.Store.SendSeen.markSeen = async () => false;
                        }
                    }
                    if (window.Store.ReadSeen && typeof window.Store.ReadSeen.sendSeen === 'function') {
                        window.Store.ReadSeen.sendSeen = async () => false;
                    }
                }
            };

            disableSeen();

            // Guard against WhatsApp Web dynamically reloading or rebinding Store
            if (!window._noReadInterval) {
                window._noReadInterval = setInterval(disableSeen, 2000);
            }
        });
    } catch (err) {
        // Ignore evaluation errors if page is navigating or reloading
    }
}

/**
 * Applies NoRead protections to a whatsapp-web.js Client instance.
 * 
 * @param {import('whatsapp-web.js').Client} client 
 * @param {Object} [options]
 * @param {boolean} [options.blockInboundEvents=true] - Block attaching listeners to message read events
 * @param {boolean} [options.disableSendSeen=true] - Suppress blue ticks globally
 * @param {boolean} [options.preserveUnreadOnSend=true] - Keep unread badge intact after sending
 * @param {boolean} [options.stealthPresence=true] - Keep presence offline (unavailable)
 * @returns {import('whatsapp-web.js').Client}
 */
function applyNoRead(client, options = {}) {
    const config = {
        blockInboundEvents: options.blockInboundEvents !== false,
        disableSendSeen: options.disableSendSeen !== false,
        preserveUnreadOnSend: options.preserveUnreadOnSend !== false,
        stealthPresence: options.stealthPresence !== false,
        ...options
    };

    console.log('🔒 [NoRead] Activating Write-Only privacy module for WhatsApp Client...');

    // ----------------------------------------------------
    // 1. Block Inbound Message Reading Listeners
    // ----------------------------------------------------
    if (config.blockInboundEvents) {
        const originalOn = client.on.bind(client);
        const originalAddListener = client.addListener.bind(client);
        const originalPrependListener = client.prependListener.bind(client);

        function filterListener(event, handler, originalMethod) {
            if (SENSITIVE_READ_EVENTS.has(event)) {
                console.warn(`⚠️ [NoRead] Blocked listener for event "${event}". Bot is in write-only mode and cannot read conversations.`);
                // Return client without attaching handler
                return client;
            }
            return originalMethod(event, handler);
        }

        client.on = function (event, handler) {
            return filterListener(event, handler, originalOn);
        };

        client.addListener = function (event, handler) {
            return filterListener(event, handler, originalAddListener);
        };

        client.prependListener = function (event, handler) {
            return filterListener(event, handler, originalPrependListener);
        };

        // Neutralize message history searching
        client.searchMessages = async function () {
            console.warn('⚠️ [NoRead] searchMessages is disabled in write-only mode.');
            return [];
        };

        // Neutralize Chat.prototype.fetchMessages if Chat is defined
        if (Chat && Chat.prototype) {
            Chat.prototype.fetchMessages = async function () {
                console.warn('⚠️ [NoRead] fetchMessages is disabled in write-only mode.');
                return [];
            };
        }
    }

    // ----------------------------------------------------
    // 2. Disable sendSeen at Node.js level
    // ----------------------------------------------------
    if (config.disableSendSeen) {
        client.sendSeen = async function (chatId) {
            // Silently return false to prevent sending read receipts
            return false;
        };

        if (Chat && Chat.prototype) {
            Chat.prototype.sendSeen = async function () {
                return false;
            };
        }
    }

    // ----------------------------------------------------
    // 3. Intercept client.sendMessage to force sendSeen: false
    //    and optionally preserve unread badges
    // ----------------------------------------------------
    const originalSendMessage = client.sendMessage.bind(client);

    client.sendMessage = async function (chatId, content, sendOptions = {}) {
        // Enforce sendSeen: false so whatsapp-web.js doesn't call window.WWebJS.sendSeen()
        const modifiedOptions = {
            ...sendOptions,
            sendSeen: false
        };

        let hadUnread = false;
        let chat = null;

        if (config.preserveUnreadOnSend) {
            try {
                chat = await client.getChatById(chatId);
                if (chat && chat.unreadCount > 0) {
                    hadUnread = true;
                }
            } catch (err) {
                // If fetching chat fails, continue with send
            }
        }

        // Send the message
        const messageResult = await originalSendMessage(chatId, content, modifiedOptions);

        // If the chat previously had unread messages, ensure the unread state is preserved
        if (hadUnread && chat && typeof chat.markUnread === 'function') {
            try {
                await chat.markUnread();
            } catch (err) {
                // Ignore markUnread failure
            }
        }

        // Keep presence offline if configured
        if (config.stealthPresence) {
            try {
                await client.sendPresenceUnavailable();
            } catch (err) {
                // Ignore presence errors
            }
        }

        return messageResult;
    };

    // ----------------------------------------------------
    // 4. Hook into 'ready' to inject browser protections & stealth
    // ----------------------------------------------------
    client.on('ready', async () => {
        console.log('🛡️ [NoRead] Injecting browser-level protections into WhatsApp Web...');
        
        if (client.pupPage) {
            await injectBrowserProtections(client.pupPage);

            // Re-inject if page navigates
            client.pupPage.on('framenavigated', async () => {
                await injectBrowserProtections(client.pupPage);
            });
        }

        if (config.stealthPresence) {
            try {
                await client.sendPresenceUnavailable();
                console.log('👻 [NoRead] Presence set to offline (unavailable).');
            } catch (err) {
                // Ignore presence error on ready
            }
        }

        console.log('✅ [NoRead] Write-Only mode fully active. Conversations are shielded.');
    });

    return client;
}

/**
 * Dedicated helper to send a message strictly in write-only mode.
 * 
 * @param {import('whatsapp-web.js').Client} client 
 * @param {string} chatId 
 * @param {string|import('whatsapp-web.js').MessageContent} content 
 * @param {Object} [options] 
 */
async function sendWriteOnlyMessage(client, chatId, content, options = {}) {
    return client.sendMessage(chatId, content, {
        ...options,
        sendSeen: false
    });
}

module.exports = {
    applyNoRead,
    sendWriteOnlyMessage
};
