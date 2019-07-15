'use strict';
/*
TODO:
- change your name
- indicate when the other end is disabled (e.g., disable the local controls?)
- color for name in chat and label (and later for drawing on screen sharing)
- status/buttons as hover/click overlay instead of below.
- kick
- don't enable kick/nameChange until you're in for 15 seconds
- more ice servers, and CHECK THEM
- recognize chat links and open them in a new tab.
- ui for user to pick someone to make big
- draw on screeen-sharing display, with drawing shared to everyone

- rooms (auto named)
- room name in title+h1
- lobby with listing of current rooms
- choice to list in lobby or not
- free form room name (but can't list in lobby)
*/

// Which categories should be logged to console.
const LOGGING = [
    'JOIN',
    'EXIT',
    'STATUS',
    'construct',
    'offer',
    'icecandidate',
    'answer',
    'stream'
];
// Like console.log, but conditional on whether the first arg appears in the list above.
function log(key, ...rest) {
    if (LOGGING.includes(key)) console.log(key, ...rest);
}

const Q = Croquet.Constants; // Shared among all participants, and part of the hashed definition to be replicated.
Q.APP_VERSION = "Conference 0.0.29"; // Reving this guarantees a fresh model (e.g., when view usage changes incompatibly.
Q.ICE_SERVERS = null;  // Free-riding on open resources.

// Croquet gives us a convenient way of:
// - starting with the right state (model), which we use for an ordered list of those present, chat history, and drawing; and
// - sending ordered messages, which we use for WebRTC "signalling" and for new text chat or drawing messages.


// REPLICATED MODELS

// Handles messages/state for the room as a whole.
class MeetingModel extends Croquet.Model {
    init(options={}) {  // Only executed the very first time, or when there isn't a cached snapshot.
        super.init(options);
        this.users = new Map(); // Not object, so that each replica is guaranteed to have keys in the order added.
        this.namePool = Q.NAMES.concat();
        this.history = [];
        this.subscribe(this.sessionId, "view-join", this.viewJoin);
        this.subscribe(this.sessionId, "view-exit", this.viewExit);
        this.subscribe("input", "newPost", this.newPost);
    }

    viewJoin(userId) { // Handles replicated message from Croquet that someone has joined.
        const nickname = this.safeName();
        log('JOIN', 'model', nickname, userId);
        const user = UserModel.create({userId: userId, name: nickname}); // Create takes one object argument.
        this.users.set(userId, user);
        this.publish(this.sessionId, 'addUser', user);
        this.publish("viewInfo", "refresh");
    }

    viewExit(userId) { // Handles replicated message from Croquet that someone has left.
        // Note that that if you refresh, you are a different user. No one (including you) had
        // previously gotten the message that someone left (your old session before reloading), so
        // the NEW session will immediately get a message about the old user leaving.
        const user = this.users.get(userId);
        log('EXIT', 'model', user.name);
        this.publish(this.sessionId, 'removeUser', user);
        this.namePool.push(user.name);
        var name = user.name;
        this.users.delete(userId);
        user.destroy();
        this.publish("viewInfo", "refresh");
    }

    newPost(post) { // Handles replicated message from some browser's Meeting View about text chat.
        const nickname = this.users.get(post.userId).name;
        this.addToHistory(`<b>${nickname}:</b> ${this.escape(post.text)}`);
    }
    addToHistory(item) { // Utility for above.
        this.history.push(item);
        if (this.history.length > 100) this.history.shift();
        this.publish("history", "refresh");
    }
    escape(text) {  // Utility for above.
        // Clean up text to remove html formatting characters
        return text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;");
    }
    safeName() { // Utility for new-entrant replicated name assignment.
        return this.namePool.shift();
    }
}
MeetingModel.register();

// Trampolines the RTC signalling messages from a View in one browser, do a different View in another browser.
class UserModel extends Croquet.Model {
    init(options = {}) {
        super.init();
        this.userId = options.userId;
        this.name = options.name;       
        // A Croquet.View in one browser cannot publish to a Croquet.View in a different browser, p2p style. (The model for order of
        // messages would get incredibly messed up.) So, the Avatars need relay their p2p signalling through the model.
        this.subscribe(this.userId, 'offer', this.offer);
        this.subscribe(this.userId, 'icecandidate', this.icecandidate);
        this.subscribe(this.userId, 'answer', this.answer);
    }
    // Trampolines to this Avatar
    offer(payload) { this.publish(this.userId, 'tramp-offer', payload); }
    icecandidate(payload) { this.publish(this.userId, 'tramp-icecandidate', payload); }
    answer(payload) { this.publish(this.userId, 'tramp-answer', payload); }
}
UserModel.register();


// USER/BROWSER-SPECIFIC VIEWS of the above. E.g., each has a viewId that is specific for this replica in this browser.

// Handles view messages of the room as a whole (from the MeetingModel).
// Also, since each person's browser has just one instance of this, we create/cache the browsers-specific media stream
// info here (for Webcam video/audio, and for shared screens), where they are accessible to each MediaAvatar in this browser.
class MeetingView extends Croquet.View {
    constructor(model) { // Set up the room-wide display, handlers, and subscriptions.
        super(model);
        this.model = model;
        this.initializeConnectionWithIncomingUser = true;
        this.toggleAbout();
        this.refreshHistory();
        this.mediaAvatars = new Map();
        model.users.forEach(user => this.addUser(user));

        this.subscribe(this.sessionId, "addUser", this.addUser);
        this.subscribe(this.sessionId, "removeUser", this.removeUser);
        this.subscribe("history", "refresh", this.refreshHistory);
        this.subscribe("viewInfo", "refresh", this.refreshViewInfo);
        this.subscribe(this.viewId, "shareAll", this.shareAll);

        sendButton.onclick = () => this.send();
        closeButton.onclick = () => this.toggleAbout();
        openButton.onclick = () => this.toggleAbout();
    }

    // Depending on the age of the most recent snapshot, we are NOT guaranteed to have all previous users in the model.users Map
    // at the time we receive our snapshot - we could get some in the Map and some via view-join => addUser events.
    // However, we are guaranteed that addUsers will be called in order for each one.
    addUser(model) { // Message from model to instantiate an avatar.
        log('JOIN', 'view', model.name);
        const user = new MediaAvatar(model, this, this.initializeConnectionWithIncomingUser);
        this.mediaAvatars.set(model.userId, user);
        if (user.isMyself) { // Anyone who comes in after us will initiate the handshake themselves.
            this.initializeConnectionWithIncomingUser = false;
        }
        this.refreshHistory();
    }
    removeUser(model) {  // Message from model to remove an avatar.
        const userId = model.userId, avatar = this.mediaAvatars.get(userId);
        log('EXIT', 'view', model.name);
        if (!avatar) return;
        avatar.bye();
        this.mediaAvatars.delete(userId);
    }
    
    send() { // Button handler to send replicated message to model with the newPost.
        const post = { userId: this.viewId, text: textIn.value };
        this.publish("input", "newPost", post);
        textIn.value = "";
    }
    toggleAbout() { // Button handler to open/close the modal "about" dialog.
        about.classList.toggle("closed");
        aboutOverlay.classList.toggle("closed");
    }        

    refreshViewInfo() { // Utility for user join/exit.
        const count = this.model.users.size;
        viewCount.innerHTML = count + ((count == 1) ? "user" : "users");
    }
    refreshHistory() { // Utiltiy for text chat change.
        const user = this.model.users.get(this.viewId);        
        textOut.innerHTML =
            `<b>${user ? `Welcome, ${user.name}!` : 'Welcome!'}</b><br>` +
            this.model.history.join("<br>");
        textOut.scrollTop = Math.max(10000, textOut.scrollHeight);
    }
    
    localMedia(userToBeInitialized, streamKind) {
        // Each avatar in our browser will have a two-way connection between us and the user represented by that avatar.
        // Each avatar in our browser will want to individually put our browser's video/audio 'webcam' stream and/or our
        // browser's 'screen' stream onto it's end of the connection to that other user. So, the CONNECTION is per-avatar, but
        // the underlying streams are per-browser. We create and cache those underlying per-browser streams here in the
        // MeetingView, which has only a single instance per browser, and to which all avatars in that browser has access.
        log('stream', 'localMedia streamKind:', streamKind, 'existing:', !!this[streamKind], 'user:', userToBeInitialized && userToBeInitialized.model.name);

        if (this[streamKind]) return this[streamKind];
        if (!userToBeInitialized) return Promise.resolve(null); // See clearMediaPromise.

        var getter, constraints;
        if (streamKind === 'screen') {
            getter = 'getDisplayMedia';
            constraints = {};
        } else {
            getter = 'getUserMedia';
            constraints = {video: true, audio: true}
        }
        return this[streamKind]
            = navigator.mediaDevices[getter](constraints)
            .then(stream => {
                if (!stream) return;
                const ourAvatar = this.mediaAvatars.get(this.viewId);
                stream.getTracks().forEach(track => { // Shut down by user, using direct browser controls.
                    track.onended = () => ourAvatar.stopStream(stream, streamKind);
                });
                return stream;
            })
            .catch(exception => {
                this.clearMediaPromise(streamKind);
                userToBeInitialized.statusChange(exception.name);
            });
    }
    clearMediaPromise(streamKind) {
        // The idea is to not re-ask unless through user action (above), and
        // yet allow the user to say "no" and then re-ask when the user actively toggles the control.
        // Alas, the right user-agent behavior is still in flux among the different browsers.
        const old = this[streamKind];
        this[streamKind] = false;
        return old;
    }
    shareAll(streamKind) { // Share our stream to every current participant.
        var count = 0;  // A pun for whether or not to force. i.e., don't force subsequent if user denies the first.
        this.mediaAvatars.forEach(avatar => avatar.media(!count++, streamKind));
    }
}

// One for each user present, including myself. Each has a connection to the user, through which we send
// our media streams to that user, and through which we receive the media streams from that user.
// Also handles the buttons for stop/starting the local display of stream tracks from that user.
// (The avatar for ourself is a bit different in that we skip the connection, and that stopping a track
// doesn't just stop our local display of ourself, but also the underlying stream that everyone else gets.)
// While this class is a bit big, the methods are divided into sections on construction, utilities,
// DOM interactions, media, p2p messaging, and signalling.
class MediaAvatar extends Croquet.View {
    constructor(model, meetingView, shouldInitializeConnectionWithThisUser) {
        // Adds the DOM elements, wires the button handlers, starts the connection signalling to this user
        // IFF we shouldInitializeConnectionWithThisUser (which by construction is true for us and everyone
        // who came before us).
        super(model);
        this.model = model;
        this.meeting = meetingView;
        this.isMyself = (model.userId === this.viewId); // Is this the avatar for me?
        log('construct', this.constructor.name, model.name, 'shouldInitialize:', shouldInitializeConnectionWithThisUser);

        const element = this.element = this.copyTemplate(userTemplate);
        videos.appendChild(element);        
        this.webcamElement = element.querySelector('video.webcam');
        this.screenElement = element.querySelector('video.screen');
        this.status = element.getElementsByClassName('status')[0];
        element.getElementsByClassName('name')[0].innerHTML = model.name;
        
        ['startVideo', 'stopVideo', 'startAudio', 'stopAudio', 'startScreen', 'stopScreen'].forEach(label => this.buttonHandlerByClassName(label, element));
        
        if (!this.isMyself) { // We don't use a connection for our display of ourself.
            // We COULD do so, but there is no "loopback" connection type, so there would have to be a
            // distributor RTCPeerConnection and a second receiving RTCPeerConnection, and the code gets messy.
            this.setupPeerConnection();
        }
        if (shouldInitializeConnectionWithThisUser) {
            this.media(true, 'webcam');
        }
        this.media(false, 'screen'); // Adds screen sharing track from this browser IFF it's already being shared to others.
    }
    bye() { // Clean up when this user leaves.
        log('EXIT', this.model.name);
        if (this.connection) this.connection.close();
        if (this.element) this.element.parentNode.removeChild(this.element);
        this.detach();
    }

    // UTILITIES
    name(userId) { // Of other users. Used in logging.
        const user = this.meeting.model.users.get(userId)
        return user ? user.name : 'removed';
    }

    // DOM INTERACTIONS
    copyTemplate(domElement) {
        // I'd like to imagine that that everything the css stylist needs to know is in the .html,
        // and that there's no need to slog through the .js.
        // So index.html has a template element with class="template ..." that we will copy.
        const element = document.createElement(domElement.tagName);
        element.innerHTML = domElement.innerHTML;
        element.classList = domElement.classList;
        element.classList.remove('template');
        return element;
    }
    statusChange(label) { // As signalling state changes, records progress in display and console.
        log('STATUS', this.model.name, label);
        this.status.innerHTML = label;
    }
    indicateTrack(trackKind, enabled) { // Toggle the video/audio/screen start/stop pair to be displayed, using css.
        this.element.classList[enabled ? 'add' : 'remove'](trackKind);
    }
    displayStream(stream, streamKind) { // Wire a stream to the correct display (and update status).
        if (streamKind === 'screen') {
            this.screenElement.srcObject = stream;
            this.indicateTrack('screen', stream);
        } else {
            this.webcamElement.srcObject = stream;
            if (stream) {
                stream.getTracks().forEach(track => this.indicateTrack(track.kind, track.enabled));
            } else {
                this.indicateTrack('video', false);
                this.indicateTrack('audio', false);
            }
        }
        this.statusChange(stream ? streamKind : streamKind + " off");
    }
    buttonHandlerByClassName(className, domElement) { // Wires a click handler to domElement child having className
        domElement.getElementsByClassName(className)[0].onclick = event => this[className](event)
    }
    // Track button handlers.
    startVideo() {
        this.allowTrack('video', true);
    }
    stopVideo() {
        this.allowTrack('video', false);
    }
    startAudio() {
        this.allowTrack('audio', true);
    }
    stopAudio() {
        this.allowTrack('audio', false);
    }
    startScreen() {
        this.allowTrack('screen', true);
    }
    stopScreen() {
        this.media(false, 'screen').then(stream => stream && this.stopStream(stream, 'screen'));
    }

    // MEDIA
    // Get our room copy of the stream, and wire it to the peer connection (or directly to display for our own avatar).
    media(force, streamKind) {
        return this.meeting
            .localMedia(force && this, streamKind)
            .then(stream => {
                /* FIXME remove
                if (stream && !stream.active) { // Turned off by user. There is no event, so we have to check.
                    this.meeting.clearMediaPromise(streamKind);
                    return this.media(force, streamKind); // try again
                    }*/
                if (this.isMyself) {
                    this.displayStream(stream, streamKind);
                } else { // Add the tracks to the peer connection (which might trigger negotiatiation).
                    const peer = this.connection;
                    const tracks = stream ? stream.getTracks() : []; // No stream if rejected by user.
                    const receiverName = this.name(this.model.userId);
                    log('stream', tracks.length, 'track from', this.model.name, 'view here to user', receiverName);
                    if (receiverName !== 'removed') {
                        // The track may have already been added (e.g., if this in answer to something previously negotiated).
                        tracks.forEach(track => {
                            if (!peer.getSenders().find(sender => sender.track && (sender.track.id === track.id))) {
                                peer.addTrack(track, stream)
                            }
                        });
                    }
                }
                return stream;
            });
    }
    stopStream(stream, streamKind) {
        log('stream', 'stopStream', streamKind, stream);
        if (!this.meeting.clearMediaPromise(streamKind)) return; // already cleared
        // stop all the tracks on this stream
        stream.getTracks().forEach(track => track.stop());
        this.displayStream(null, streamKind); // allows stream to be released
    }
    allowTrack(trackKind, enabled) { // stopping and restarting video/audio/screen
        function perTrack(track) {
            if (track.kind === trackKind) {
                track.enabled = enabled;
            }
        }
        if (this.isMyself) { // Special case for our own avatar, which doesn't have a peer connection.
            const streamKind = (trackKind === 'screen') ? 'screen' : 'webcam';
            this.media(false, streamKind).then(existingStream => {
                if (existingStream) { // Turn it on off at the stream, so that it effects everyone.
                    existingStream.getTracks().forEach(perTrack);
                    this.indicateTrack(trackKind, enabled && stream);
                } else if (enabled) { // No existing stream because it's been shut down (e.g, by user action in browser).
                    this.meeting.shareAll(streamKind); // Restart/attach for all existing users
                } else { // Shouldn't happen, but let's make sure the display matches
                    this.displayStream(null, streamKind);
                }
            });
        } else { // Other user's avatars, just frob this local peer receiver that is hooked to this display.
            const receivers = this.connection.getReceivers();
            receivers.forEach(receiver => perTrack(receiver.track));
            this.indicateTrack(trackKind, enabled && receivers.length);
        }
    }

    // P2P MESSAGING
    // We want to send to either:
    //   the model for the user that maches us (this.viewId), or
    //   only the instance that we will display (this.model.userId).
    // But there is no p2p messaging, so we broadcast to all replicas of our model, and let each replica filter for the 'concern'.
    // While it may seem weird to have the reflector broadcast to everyone when only one receiving browser will do anything, this
    // is part of the uniform and efficient model.
    p2pSend(event, message) { // Publish through the model.
        if (message === undefined) message = null; // Else json stringify fails.
        const payload = {concern: this.model.userId, message: JSON.stringify(message)};
        log(event, 'sent to', this.name(this.viewId), '@', this.name(payload.concern));
        this.publish(this.viewId, event, payload);
    }
    p2pReceive(event, handler) { // Subscribe and handler.
        const bound = handler.bind(this);
        log(event, 'subscribe tramp-', this.name(this.model.userId));
        this.subscribe(this.model.userId, 'tramp-' + event, payload => {
            const concernsThisClient = this.viewId === payload.concern;
            log(event, 'received', this.name(this.model.userId), '@', this.name(payload.concern), concernsThisClient);
            if (concernsThisClient) bound(JSON.parse(payload.message));
        });
    }

    // SIGNALLING: See https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling
    icecandidate(iceCandidate) { // Our end of connection has received a candidate, which must be sent to the other end.
        this.connection.addIceCandidate(iceCandidate).catch(e => console.error('CONNECTION ADD ICE FAILED', e.name, e.message));
    }
    negotiationneeded() { // When we add a track (not just toggling enable), we get this event to start the signalling process.
        const peer = this.connection;
        peer.createOffer({})
            .then(offer => { peer.setLocalDescription(offer); return offer; }) // FIXME promises, offer, etc.
            .then(offer => this.p2pSend('offer', offer));
    }
    offer(offer) { // Handler for receiving an offer from the other user (who started the signalling process).
        // Note that during signalling, we will receive negotiationneeded/answer, or offer, but not both, depending
        // on whether we were the one that started the signalling process.
        const peer = this.connection;
        var answer;
        peer.setRemoteDescription(offer)
            .then(() => this.media(false, 'webcam'))
            .then(() => peer.createAnswer())
            .then(result => answer = result)
            .then(() => peer.setLocalDescription(answer))
            .then(() => this.p2pSend('answer', answer));
    }
    answer(answer) { // Handler for finishing the signalling process that we started.
        this.connection.setRemoteDescription(answer);
    }
    setupPeerConnection() { // One-time setup of our end of connection and handlers, regardless of whether we shouldInitializeConnectionWithThisUser.
        this.p2pReceive('offer', this.offer);
        this.p2pReceive('icecandidate', this.icecandidate);
        this.p2pReceive('answer', this.answer);
        
        const connection = this.connection = new RTCPeerConnection(Q.ICE_SERVERS);
        
        connection.addEventListener('connectionstatechange', event => this.statusChange(connection.connectionState));
        connection.addEventListener('negotiationneeded', event => this.negotiationneeded());
        connection.addEventListener('icecandidate', event => this.p2pSend('icecandidate', event.candidate));
        connection.addEventListener("track", event => {
            // We've received notice that the other end of the connection has supplied a track. This is the event
            // that the standards provide for our end to wire up the appropriate player on our end.
            // KLUDGE ALERT: 
            // We send audio & video tracks on one stream, and screen sharing on another stream, but both over the
            // same connection. So how do we know where to display the two streams? There is no way to attach arbitrary
            // application-defined metadata to the track. (We could send an out of band message through Croquet,
            // indicating the track.id / sourceKind pairs, but the order/timing is awkward.)
            // Solution: Count the tracks on the associated stream!
            var index, stream, tracks,
                streams = event.streams,
                nStreams = streams.length,
                trackId = event.track.id;
            for (index = 0; index < nStreams; index++) {
                stream = streams[index];
                tracks = stream.getTracks();
                if (tracks.find(streamTrack => streamTrack.id === trackId)) { // Does this stream contain the track for this event?
                    if (tracks.length === 1) {
                        // Even if we get events separately for audio and video, the second one will be right. :-)
                        this.displayStream(stream, 'screen');
                    } else {
                        this.displayStream(stream, 'webcam');
                    }
                    return;
                }
            }
        });
    }
}

Q.NAMES = [ 'Oatmeal', 'Tahini', 'Cherry', 'Caraway', 'Eggplant', 'Sea Salt', 'Fennel', 'Shiitake', 'Chocolate', 'Hummus', 'Jalepeno', 'Peach', 'Tarragon', 'Aoli', 'Sesame Seed', 'Tofu', 'Watermelon', 'Halvah', 'Cilantro', 'Eclair', 'Strudel', 'Maple Syrup', 'Pecan', 'Mint', 'Thyme', 'Anise', 'Quince', 'Blackberry', 'Bergamot', 'Ginseng', 'Coconut', 'Honeydew', 'Cupcake', 'Nectarine', 'Gumbo', 'Tabasco', 'Baklava', 'Parsnip', 'Hazelnut', 'Tumeric', 'Clove', 'Bay Leaf', 'Fig', 'Ginger', 'Sorrel', 'Habanero', 'Tangerine', 'Vinegar', 'Cinnamon', 'Espresso', 'Arrowroot', 'Canaloupe', 'Valerian', 'Peanut Butter', 'Plum', 'Caramel', 'Camphor', 'Matcha', 'Tandoori', 'Harissa', 'Acorn', 'Pumpkin', 'Vanilla', 'Macaron', 'Blueberry', 'Felafel', 'Cappuccino', 'Coriander', 'Cayenne', 'Mustard', 'Olive Oil', 'Basil', 'Pennyroyal', 'Chives', 'Avocado', 'Pineapple', 'Natto', 'Mayonnaise', 'Truffle', 'Yuzu', 'Cardamom', 'Licorice', 'Dill', 'Saffron', 'Horseradish', 'Balsamic', 'Ghost Pepper', 'Yarrow', 'Sunflower Seed', 'Grapefruit', 'Bacon', 'Cauliflower', 'Pomegranate', 'Curry', 'Allspice', 'Chervil', 'Watercress', 'Ancho', 'Cookie Dough', 'Hyssop', 'Ratatouille', 'Rosemary', 'Catnip', 'Ketchup', 'Persimmon', 'Spearmint', 'Sage', 'Chicory', 'Asparagus', 'Chutney', 'Broccoli', 'Almond', 'Sriracha', 'Chipotle', 'Key Lime', 'Tamarind', 'Sassafras', 'Barbecue', 'Pistachio', 'Papaya', 'Chamomile', 'Lemon Zest', 'Marshmallow', 'Kiwi', 'Kumquat', 'Mulberry', 'Lemon Grass', 'Kohlrabi', 'Rosewater', 'Marjoram', 'Juniper', 'Oregano', 'Cranberry', 'Apple', 'Croissant', 'Nutmeg', 'Banana', 'Dandelion', 'Parsley', 'Mango', 'Wheatgrass', 'Strawberry', 'Cabbage', 'Zucchini', 'Garlic', 'Cumin', 'Poppy Seed', 'Peppercorn', 'Orange Peel', 'Paprika', 'Cucumber', 'Latte', 'Buttermilk', 'Wasabi', 'Gelato', 'Lavender', 'Earl Grey', 'Soy Sauce', 'Celery', 'Apricot', 'Raspberry', 'Walnut', 'Durian' ];

Croquet.startSession("chat", MeetingModel, MeetingView);
