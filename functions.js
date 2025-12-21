import {app} from '@azure/functions';

// Azure Functions v4 (Node.js) entry point.
// All HTTP and other trigger-based functions are registered via imports
// from the ./functions directory tree.

// System functions
import './functions/system/get-health.js';
import './functions/system/get-all-tenants.js';
import './functions/system/get-tenant-options.js';
import './functions/system/get-default-theme.js';
import './functions/system/get-tenant-config.js';
import './functions/system/get-taxonomy.js';

// Auth functions
import './functions/auth/check-username.js';
import './functions/auth/passwordless-register.js';
import './functions/auth/request-challenge.js';
import './functions/auth/verify-challenge.js';
import './functions/auth/get-user-public-key.js';
import './functions/auth/check-user-exists.js';

// User functions
import './functions/user/update-interests.js';
import './functions/user/get-matches.js';
import './functions/user/update-location.js';
import './functions/user/get-nearby-activity.js';
import './functions/user/get-widgets.js';
import './functions/user/get-user-widgets.js';
import './functions/user/add-user-widget.js';
import './functions/user/remove-user-widget.js';

// Realtime (Socket.IO / Web PubSub) functions
import './functions/realtime/negotiate.js';
import './functions/realtime/join-room.js';
import './functions/realtime/leave-room.js';
import './functions/realtime/check-user-online.js';
import './functions/realtime/get-associated-socket-id.js';
import './functions/realtime/send-chat-request.js';
import './functions/realtime/ack-chat-request.js';
import './functions/realtime/accept-chat-request.js';
import './functions/realtime/reject-chat-request.js';
import './functions/realtime/cancel-chat-request.js';
import './functions/realtime/delete-chat.js';
import './functions/realtime/send-message.js';
import './functions/realtime/heartbeat.js';
import './functions/realtime/on-socket-connected.js';
import './functions/realtime/on-socket-disconnected.js';
import './functions/realtime/on-ping-message.js';

export {app};

