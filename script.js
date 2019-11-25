'use strict';
/*
TODO:
- late arrivals do not see share screens in progress
- just show connection status in "status". No point in duplicating what is in icons

- don't display screenshare unless it's in use
- toggle any video to be big

- change your name
- kick
- don't enable kick/nameChange until you're in for 15 seconds
- recognize chat links and open them in a new tab.

- code review: methods are verbs, properties are nouns
- code review: andreas-annotation
- code review: consolidate trackKind <=> streamKind conversions
- code review: put each logging category through paces individually, and see if they make sense
- more ice servers, and CHECK THEM
- tooltips
- license in github
- qr code in codepen

- color for name in chat and label (and later for drawing on screen sharing)
- draw on screeen-sharing display, with drawing shared to everyone

- bug: If you block webcam, you don't see other people's streams.

- file sharing (as media through connection)
- individual volume controls

- rooms (auto named)
- room name in title+h1
- lobby with listing of current rooms
- choice to list in lobby or not
- type-in room name (but can't list in lobby)
*/

// Which categories should be logged to console.
const LOGGING = [
    //'JOIN',
    //'EXIT',
    'STATUS',
    //'construct',
    'negotiationneeded',
    'offer',
    'icecandidate',
    'answer',
    //'requestInitialization',
    'stream',
    'track'
];
// Like console.log, but conditional on whether the first arg appears in the list above.
function log(key, ...rest) {
    if (LOGGING.includes(key)) console.log(key, ...rest);
}

// Croquet gives us a convenient way of:
// - starting with the right state (model), which we use for an ordered list of those present, chat history, and drawing; and
// - sending ordered messages, which we use for WebRTC "signalling" and for new text chat or drawing messages.
const Q = Croquet.Constants; // Shared among all participants, and part of the hashed definition to be replicated.
Q.APP_VERSION = "Conference 0.0.44"; // Rev'ing guarantees a fresh model (e.g., when view usage changes incompatibly during development).
Q.ICE_SERVERS = null;  // Free-riding on open resources.


// REPLICATED MODELS

// Handles messages/state for the room as a whole.
class MeetingModel extends Croquet.Model {
    init(options={}) {  // Only executed the very first time, or when there isn't a cached snapshot.
        super.init(options);
        this.users = new Map(); // Not object, so that each replica is guaranteed to have keys in the order added.
        this.namePool = [ 'Oatmeal', 'Tahini', 'Cherry', 'Caraway', 'Eggplant', 'Sea Salt', 'Fennel', 'Shiitake', 'Chocolate', 'Hummus', 'Jalepeno', 'Peach', 'Tarragon', 'Aoli', 'Sesame Seed', 'Tofu', 'Watermelon', 'Halvah', 'Cilantro', 'Eclair', 'Strudel', 'Maple Syrup', 'Pecan', 'Mint', 'Thyme', 'Anise', 'Quince', 'Blackberry', 'Bergamot', 'Ginseng', 'Coconut', 'Honeydew', 'Cupcake', 'Nectarine', 'Gumbo', 'Tabasco', 'Baklava', 'Parsnip', 'Hazelnut', 'Tumeric', 'Clove', 'Bay Leaf', 'Fig', 'Ginger', 'Sorrel', 'Habanero', 'Tangerine', 'Vinegar', 'Cinnamon', 'Espresso', 'Arrowroot', 'Canaloupe', 'Valerian', 'Peanut Butter', 'Plum', 'Caramel', 'Camphor', 'Matcha', 'Tandoori', 'Harissa', 'Acorn', 'Pumpkin', 'Vanilla', 'Macaron', 'Blueberry', 'Felafel', 'Cappuccino', 'Coriander', 'Cayenne', 'Mustard', 'Olive Oil', 'Basil', 'Pennyroyal', 'Chives', 'Avocado', 'Pineapple', 'Natto', 'Mayonnaise', 'Truffle', 'Yuzu', 'Cardamom', 'Licorice', 'Dill', 'Saffron', 'Horseradish', 'Balsamic', 'Ghost Pepper', 'Yarrow', 'Sunflower Seed', 'Grapefruit', 'Bacon', 'Cauliflower', 'Pomegranate', 'Curry', 'Allspice', 'Chervil', 'Watercress', 'Ancho', 'Cookie Dough', 'Hyssop', 'Ratatouille', 'Rosemary', 'Catnip', 'Ketchup', 'Persimmon', 'Spearmint', 'Sage', 'Chicory', 'Asparagus', 'Chutney', 'Broccoli', 'Almond', 'Sriracha', 'Chipotle', 'Key Lime', 'Tamarind', 'Sassafras', 'Barbecue', 'Pistachio', 'Papaya', 'Chamomile', 'Lemon Zest', 'Marshmallow', 'Kiwi', 'Kumquat', 'Mulberry', 'Lemon Grass', 'Kohlrabi', 'Rosewater', 'Marjoram', 'Juniper', 'Oregano', 'Cranberry', 'Apple', 'Croissant', 'Nutmeg', 'Banana', 'Dandelion', 'Parsley', 'Mango', 'Wheatgrass', 'Strawberry', 'Cabbage', 'Zucchini', 'Garlic', 'Cumin', 'Poppy Seed', 'Peppercorn', 'Orange Peel', 'Paprika', 'Cucumber', 'Latte', 'Buttermilk', 'Wasabi', 'Gelato', 'Lavender', 'Earl Grey', 'Soy Sauce', 'Celery', 'Apricot', 'Raspberry', 'Walnut', 'Durian' ];
        this.history = [];
        this.subscribe(this.sessionId, "view-join", this.join);
        this.subscribe(this.sessionId, "view-exit", this.exit);
        this.subscribe("input", "post", this.post);
    }

    join(userId) { // Handles replicated message from Croquet that someone has joined.
        const nickname = this.namePool.shift();
        log('JOIN', "model", nickname, userId);
        const user = UserModel.create({userId: userId, name: nickname}); // Create takes one object argument.
        this.users.set(userId, user);
        this.publish(this.sessionId, 'addUser', user);
    }
    exit(userId) { // Handles replicated message from Croquet that someone has left.
        // Note that that if you refresh, you are a different user. You had not
        // previously gotten the message that someone left (your old session before reloading), so
        // the NEW session will immediately get a message about the old user leaving.
        const user = this.findCurrentUser(userId);
        log('EXIT', "model", user.name);
        this.publish(this.sessionId, 'removeUser', user);
        this.namePool.push(user.name);
        this.users.delete(userId);
        user.destroy();
    }

    post(post) { // Handles replicated message from a browser's Meeting View about text chat.
        const nickname = this.findCurrentUser(post.userId).name,
              item = `<b>${nickname}:</b> ${this.escape(post.text)}`;
        this.history.push(item);
        if (this.history.length > 100) this.history.shift();
        this.publish('history', 'refresh');
    }

    // Utilities
    findCurrentUser(id) { // If it answers falsey, that id has already exited.
        return this.users.get(id);
    }
    escape(text) {
        // Clean up text to remove html formatting characters
        return text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;");
    }
}
MeetingModel.register();

// Trampolines the RTC signalling messages from a View in one browser, to a different View in another browser.
class UserModel extends Croquet.Model {
    init(options = {}) {
        super.init(options);
        this.userId = options.userId;
        this.name = options.name;
        this.subscribe(this.userId, 'updateStreamInfo', this.updateStreamInfo);
        // A Croquet.View in one browser cannot publish to a Croquet.View in a different browser, p2p style.
        // So, the Avatars need to relay their p2p signalling through the model.
        this.subscribe(this.userId, 'offer', this.offer);
        this.subscribe(this.userId, 'icecandidate', this.icecandidate);
        this.subscribe(this.userId, 'answer', this.answer);
        this.subscribe(this.userId, 'requestInitialization', this.requestInitialization);
    }
    updateStreamInfo(info) { // Maintains trackKind => stream.id for each of the three kinds of track,
        // such that model.screen, model.video, and model.audio is either a stream.id or falsey.
        // (A webrtc stream.id is globally unique, and the same on each end of the RTCPeerConnection.
        // But track.id is different in each browser, and thus useless for cross-browser communication.)
        log('stream', 'updateStreamInfo', this.name, info.trackKind, !!info.id);
        this[info.trackKind] = info.id;
        this.publish(this.userId, 'showTrackAvailableLocally', info.trackKind);
    }
    // Trampolines to this user's avatar.
    offer(payload) { this.publish(this.userId, 'tramp-offer', payload); }
    icecandidate(payload) { this.publish(this.userId, 'tramp-icecandidate', payload); }
    answer(payload) { this.publish(this.userId, 'tramp-answer', payload); }
    requestInitialization(payload) { this.publish(this.userId, 'tramp-requestInitialization', payload); }
}
UserModel.register();


// We define stream as being of kind 'webcam' or 'screen'.
// The former has up to two tracks, of kind 'video' or 'audio'.
// The latter has one track, of kind 'screen'. (The webrtc MediaStreamTrack kind property will still be 'video'.)
function isScreenShare(streamOrTrackKind) {
    return streamOrTrackKind === 'screen';
}

// BROWSER-SPECIFIC VIEWS of the above. E.g., each has a viewId that is specific for this replica in this browser.

// Handles view messages of the room as a whole (from the MeetingModel).
// Also, since each person's browser has just one instance of this, we create/cache the browser-specific media stream
// info here (for Webcam video/audio, and for shared screens), where they are accessible to each MediaAvatar in this browser.
class MeetingView extends Croquet.View {
    constructor(model) { // Set up the room-wide display, handlers, and subscriptions.
        super(model);
        this.model = model;
        this.refreshHistory();
        this.mediaAvatars = new Map();

        this.subscribe(this.sessionId, 'addUser', this.addUser);
        this.subscribe(this.sessionId, 'removeUser', this.removeUser);
        this.subscribe('history', 'refresh', this.refreshHistory);

        sendButton.onclick = () => this.send();
        aboutCloseButton.onclick = () => this.toggleAbout();
        openButton.onclick = () => this.toggleAbout();
        noticeCloseButton.onclick = () => this.toggleNotice();

        // The model.users has each current user in order, up to the last snapshot.
        // Here we addUser for each, and then we will addUser for each user who has joined since the snapshot.
        this.initializeConnectionWithIncomingUser = true;
        model.users.forEach(user => this.addUser(user));
    }

    // Between the above constructor and the MeetingModel join, everyone is guaranteed to get these in the same order.
    addUser(model) { // Message from model to instantiate an avatar.
        log('JOIN', "view", model.name);
        const user = new MediaAvatar(model, this, this.initializeConnectionWithIncomingUser);
        this.mediaAvatars.set(model.userId, user);
        this.refreshHistory();
        if (user.isMyself) { // Anyone who comes in after us will initiate the handshake themselves.
            this.shareAll('webcam', true);
            this.initializeConnectionWithIncomingUser = false;
        }
    }
    removeUser(model) {  // Message from model to remove an avatar.
        const userId = model.userId,
              avatar = this.mediaAvatars.get(userId);
        log('EXIT', "view", model.name);
        if (!avatar) return;
        avatar.bye();
        this.mediaAvatars.delete(userId);
    }
    
    send() { // Button handler to send replicated message to model with the post.
        const post = {
            userId: this.viewId,
            text: textIn.value
        };
        textIn.value = "";
        this.publish('input', 'post', post);
    }
    toggleAbout() { // Button handler to open/close the modal "about" dialog.
        about.classList.toggle('closed');
        modalOverlay.classList.toggle('closed');
    }        
    toggleNotice() { // Button handler to open/close the modal "about" dialog.
        notice.classList.toggle('closed');
        modalOverlay.classList.toggle('closed');
    }        
    refreshHistory() { // Utiltiy for text chat change.
        const user = this.model.findCurrentUser(this.viewId); // Until addUser of myself, name is not known.
        textOut.innerHTML =
            `<b>${user ? `Welcome, ${user.name}!` : "Welcome!"}</b><br>` +
            this.model.history.join("<br>");
        textOut.scrollTop = Math.max(10000, textOut.scrollHeight);
    }

    // We have at most one 'webcam' stream and at most one 'screen' share stream, regardless of how many MediaAvatars
    // they get distributed to. Returns a promise that resolves to either the correct stream, or to falsey if the user
    // denies access. The result is cached (because each MediaAvatar is going to be distributing the same stream), but
    // a cached falsey stream will be tried again if force is truthy.
    getBrowserStream(streamKind, force) {
        var getter, constraints;
        log('stream', "getBrowserStream", streamKind, force ? "forced" : "unforced", this[streamKind] ? "cached" : "uncached");

        if (this[streamKind]) return this[streamKind];
        if (!force) return Promise.resolve(null); // See resetBrowserStream.

        // Regardless of which MediaAvatar asked for this, update status and buttons on my avatar, where this stream
        // would be displayed.
        const myAvatar = this.mediaAvatars.get(this.viewId),
              isScreen = isScreenShare(streamKind);
        if (isScreen) {
            getter = 'getDisplayMedia';
            constraints = {};
        } else {
            getter = 'getUserMedia';
            constraints = {video: true, audio: true};
        }

        if (!navigator.mediaDevices[getter]) { // Browser feature-detect.
            myAvatar.updateStatus(streamKind + " unsupported");
            // This should be the only place we disable the buttons for my avatar.
            if (streamKind === 'screen') {
                myAvatar.showTrackAvailableLocally('screen', false);
            } else {
                myAvatar.showTrackAvailableLocally('video', false);
                myAvatar.showTrackAvailableLocally('audio', false);
            }
            return this[streamKind] = Promise.resolve(null);
        }
        
        return this[streamKind]
            = navigator.mediaDevices[getter](constraints)
            .then(stream => {
                // A browser might allow the user to deny the whole stream, or any track.
                if (!stream) return;
                stream.getTracks().forEach(track => {
                    this.updateStreamInfo(stream.id, track.kind, streamKind);
                    // A browser may allow the user to stop the stream later, in
                    // which case we will receive onended for each track.
                    track.onended = () => myAvatar.stopStream(stream, streamKind); // FIXME: do we really want to stop the whole stream? maybe.
                });
                return stream;
            })
            .catch(exception => {
                this.resetBrowserStream(streamKind);
                myAvatar.updateStatus(exception.name, exception.message);
            });
    }
    updateStreamInfo(streamId, trackKind, streamKind) { // Publish it, adjusting trackKind for streamKind.
        this.publish(this.viewId, 'updateStreamInfo', {
            trackKind: isScreenShare(streamKind) ? 'screen' : trackKind,
            id: streamId
        });
    }
    resetBrowserStream(streamKind) {
        // The idea is to not re-ask the user after denying permission (caching above), and
        // yet allow the user to be re-asked when the user actively toggles the control.
        // Alas, the user-agent behavior is still in flux among the different browsers, and some do
        // not re-ask. We do what we can.
        const old = this[streamKind];
        this[streamKind] = false;
        return old;
    }
    shareAll(streamKind, requestReciprocolIfNeeded) { // Share our stream to every current participant.
        var count = 0;  // A pun for whether or not to force. i.e., don't force subsequent if user denies the first.
        this.mediaAvatars.forEach(avatar => avatar.connectStream(streamKind, !count++, requestReciprocolIfNeeded));
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
        log('construct', this.constructor.name, model.name, "shouldInitialize:", shouldInitializeConnectionWithThisUser);

        const element = this.element = this.copyTemplate(userTemplate);
        videos.appendChild(element);        
        this.webcamElement = element.querySelector('video.webcam');
        this.screenElement = element.querySelector('video.screen');
        this.status = element.getElementsByClassName('status')[0];
        element.getElementsByClassName('name')[0].innerHTML = model.name;
        
        ['startConnection', 'stopConnection', 'startVideo', 'stopVideo', 'startAudio', 'stopAudio', 'startScreen', 'stopScreen'].forEach(label => this.buttonHandlerByClassName(label, element));

        if (this.isMyself) {
            element.classList.toggle('myself');
            // We don't use a connection for our display of ourself.
            // We COULD do so, but there is no "loopback" connection type, so there would have to be a
            // distributor RTCPeerConnection and a second receiving RTCPeerConnection, and the code gets messy.
            //
            // Besides, who needs the extra traffic? And the behavior IS actually different: e.g., the controls to
            // stop/start tracks effect ALL the OTHER connections.
            //
            // But the same userMedia stream is going out to everyone with sound, and displayed on our own video element,
            // So turn sound off at the element.
            // TODO: volume slider for playback of everyone else. Our volume slider should attenuate/boost the outgoing audio track, with a test mode.
            this.webcamElement.volume = 0;
        } else {
            ['screen', 'audio', 'video'].forEach(trackKind =>
                                                 this.showTrackAvailableLocally(trackKind, this.model[trackKind]));
            this.p2pReceive('offer', this.offer);
            this.p2pReceive('icecandidate', this.icecandidate);
            this.p2pReceive('answer', this.answer);
            this.p2pReceive('requestInitialization', this.requestInitialization);
            this.setupPeerConnection();
            // Subtle: Don't subscribe to my own showTrackAvailableLocally event, as that is ONLY disabled by feature detection.
            // Some browsers, at least, let you try again after initially saying no, without reloading, so we initial refusal should not disable them.
            this.subscribe(this.model.userId, 'showTrackAvailableLocally', this.showTrackAvailableLocally);
        }
    }
    bye() { // Clean up when this user leaves.
        log('EXIT', this.model.name);
        if (this.connection) this.connection.close();
        if (this.element) this.element.parentNode.removeChild(this.element);
        this.detach();
    }

    // UTILITIES
    findCurrentUser(userId = this.model.userId) {
        return this.meeting.model.findCurrentUser(userId);
    }
    name(userId) { // Of other users. Used in logging.
        const user = this.findCurrentUser(userId);
        return user ? user.name : 'removed';
    }

    // DOM INTERACTIONS
    updateStatus(label, more) { // As signalling state changes, records progress in display and console.
        log('STATUS', this.model.name, label, more);
    }
    showTrackPlayingLocally(trackKind, enabled) { // Toggle the video/audio/screen start/stop pair to be displayed, using css.
        this.element.classList[enabled ? 'add' : 'remove'](trackKind);
    }
    showTrackAvailableLocally(trackKind, enabled = this.model[trackKind]) { // Enable the track buttons IFF it's available to us.
        log('track', 'local', trackKind, enabled, this.name());
        const capitalized = trackKind.charAt(0).toUpperCase() + trackKind.slice(1),
              domElement = this.element;
        this.getButton('start' + capitalized, domElement).disabled = !enabled;
        this.getButton('stop' + capitalized, domElement).disabled = !enabled;    
    }
    displayStream(stream, streamKind) { // Wire a stream to the correct display, and update local status/icons.
        log('stream', 'display', streamKind, stream ? stream.id : 'EMPTY!', this.name());
        if (isScreenShare(streamKind)) {
            this.screenElement.srcObject = stream;
            this.showTrackPlayingLocally('screen', !!stream);
        } else {
            this.webcamElement.srcObject = stream;
            if (stream) {
                stream.getTracks().forEach(track => this.showTrackPlayingLocally(track.kind, track.enabled));
            } else {
                this.showTrackPlayingLocally('video', false);
                this.showTrackPlayingLocally('audio', false);
            }
        }
        this.updateStatus(streamKind, stream ? stream.getTracks().length + " track(s)" : "off");
    }
    
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
    getButton(className, domElement) { // Finds the DOM element under the given one, that has the given className.
        return domElement.getElementsByClassName(className)[0];
    }
    buttonHandlerByClassName(className, domElement) { // Wires a click handler to domElement child having className
        const element = this.getButton(className, domElement);
        element.onclick = event => this[className](event)
    }
    startConnection() { // FIXME disable this appropriately. same for stopConnection
        this.connection.getSenders().forEach(console.log); // fixme
        this.negotiationneeded();
        //this.showTrackPlayingLocally('connection', true);
    }
    stopConnection() {
        this.connection.close();
        this.setupPeerConnection();
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
        this.allowTrack('screen', false);
    }

    // MEDIA
    // Get our room copy of the stream, and wire it to the peer connection (or directly to display for our own avatar).
    // Each avatar in our browser will have a two-way connection between us and the user represented by that avatar.
    // Each avatar in our browser will want to individually put our browser's video/audio 'webcam' stream and/or our
    // browser's 'screen' stream onto it's end of the connection to that other user. So, the CONNECTION is per-avatar, but
    // the underlying streams are per-browser.
    connectStream(streamKind, force, requestReciprocolIfNecessary) {
        log('stream', 'connectStream', streamKind, force ? "forced" : "unforced", requestReciprocolIfNecessary ? "request-reciprocol" : "no-reciprocol", this.name());
        return this.meeting
            .getBrowserStream(streamKind, force)
            .then(stream => {
                if (!this.findCurrentUser()) {
                    return;
                } else if (this.isMyself) {
                    this.displayStream(stream, streamKind);
                    if (stream) {
                        stream.getTracks().forEach(track => this[isScreenShare(streamKind) ? 'screen' : track.kind] = track.id);
                    }
                } else if (stream) { // Add the tracks to the peer connection (which might trigger negotiatiation).
                    const peer = this.connection;
                    const tracks = stream.getTracks();
                    log('stream', tracks.length, streamKind, "track(s) @", this.model.name, stream.id);
                    tracks.forEach(track => {
                        // The track may have already been added (e.g., if this in answer to something previously negotiated).
                        if (!peer.getSenders().find(sender => sender.track && (sender.track.id === track.id))) {
                            peer.addTrack(track, stream)
                        }
                    });
                } else if (requestReciprocolIfNecessary) {
                    this.meeting.toggleNotice();
                    // FIXME this.p2pSend('requestInitialization', streamKind);
                }
                return stream;
            });
    }
    stopStream(stream, streamKind) { // ... and update everything, including the model
        log('stream', 'stopStream', streamKind, stream);
        if (!this.meeting.resetBrowserStream(streamKind)) return; // already cleared
        // stop all the tracks on this stream
        stream.getTracks().forEach(track => {
            this.meeting.updateStreamInfo(false, track.kind, streamKind);
            track.stop();
        });
        this.displayStream(null, streamKind); // allows stream to be released
    }
    allowTrack(trackKind, enabled) { // stopping and restarting video/audio/screen
        const perTrack = (track) => {
            if (track.id === this[trackKind]) {
                track.enabled = enabled;
            }
        }
        log('track', 'allowTrack', trackKind, enabled, this.name());
        if (this.isMyself) { // Special case for our own avatar, which doesn't have a peer connection.
            const streamKind = isScreenShare(trackKind) ? 'screen' : 'webcam';
            this.connectStream(streamKind).then(existingStream => {
                if (existingStream) {
                    // FIXME: consider this.stopStream(stream, streamKind) to turn the damn light off (and then re-enable audio if appropriate).
                    // Turn it on off at the stream, so that it effects everyone, but don't tear down stream.                    
                    existingStream.getTracks().forEach(perTrack);
                    this.showTrackPlayingLocally(trackKind, enabled);
                    this.meeting.updateStreamInfo(enabled && existingStream.id, trackKind, streamKind);
                } else if (enabled) { // No existing stream because it's been shut down (e.g, by user action in browser).
                    this.meeting.shareAll(streamKind); // Restart/attach for all existing users
                } else { // Shouldn't happen, but let's make sure the display matches
                    this.displayStream(null, streamKind);
                }
            });
        } else { // Other user's avatars, just frob this local peer receiver that is hooked to this display.
            const receivers = this.connection.getReceivers();
            receivers.forEach(receiver => perTrack(receiver.track));
            this.showTrackPlayingLocally(trackKind, enabled && receivers.length);
        }
    }
    requestInitialization(streamKind) { // fixme: either make this work or kill it
        // If the other end cannot safely make an offer (e.g., user has denied media), it may request us to
        // initialize the stream (which we will do IFF we have one).
        this.connectStream(streamKind);
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
        log(event, "sent to", this.name(this.viewId), "@", this.name(payload.concern));
        this.publish(this.viewId, event, payload);
    }
    p2pReceive(event, handler) { // Subscribe and handler.
        const bound = handler.bind(this);
        log(event, "subscribe tramp-", this.name(this.model.userId));
        this.subscribe(this.model.userId, 'tramp-' + event, payload => {
            const concernsThisClient = this.viewId === payload.concern;
            log(event, "received", this.name(this.model.userId), "@", this.name(payload.concern), concernsThisClient ? "for us" : "ignored");
            if (concernsThisClient) bound(JSON.parse(payload.message));
        });
    }

    // SIGNALLING: See https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling
    icecandidate(iceCandidate) { // Our end of connection has received a candidate, which must be sent to the other end.
        this.connection.addIceCandidate(iceCandidate).catch(e => console.error('CONNECTION ADD ICE FAILED', e.name, e.message));
    }
    negotiationneeded() { // When we add a track (not just toggling enable), we get this event to start the signalling process.
        log('negotiationneeded', this.name());
        const peer = this.connection;
        var offer;
        peer.createOffer({})
            .then(result => offer = result)
            .then(() => peer.setLocalDescription(offer)) // promise does not resolve to offer
            .then(() => this.p2pSend('offer', offer));
    }
    offer(offer) { // Handler for receiving an offer from the other user (who started the signalling process).
        // Note that during signalling, we will receive negotiationneeded/answer, or offer, but not both, depending
        // on whether we were the one that started the signalling process.
        const peer = this.connection;
        var answer;
        peer.setRemoteDescription(offer)
            .then(() => this.connectStream('webcam'))
            .then(() => peer.createAnswer())
            .then(result => answer = result)
            .then(() => peer.setLocalDescription(answer)) // promise does not resolve to answer
            .then(() => this.p2pSend('answer', answer));
    }
    answer(answer) { // Handler for finishing the signalling process that we started.
        this.connection.setRemoteDescription(answer);
    }
    setupPeerConnection() { // One-time setup of our end of connection and handlers, regardless of whether we shouldInitializeConnectionWithThisUser.
        this.showTrackPlayingLocally('connection', false);
        
        const connection = this.connection = new RTCPeerConnection(Q.ICE_SERVERS);
        
        connection.addEventListener('connectionstatechange', event => {
            this.showTrackPlayingLocally('connection', connection.connectionState === 'connected');
            if (['disconnected', 'closed'].includes(connection.connectionState)) {
                this.stopConnection();
                //this.connection.close();
                //this.setupPeerConnection(); // FIXME
            }
            this.updateStatus(connection.connectionState);
        });
        connection.addEventListener('negotiationneeded', event => this.negotiationneeded());
        connection.addEventListener('icecandidate', event => this.p2pSend('icecandidate', event.candidate));
        connection.addEventListener('track', event => {
            // We've received notice that the other end of the connection has supplied a track. This is the event
            // that the standards provide, for our end to wire up the appropriate player on our end.
            // Alas, the standards don't provide any way for application-specific labels on the tracks as to which
            // video player should be used, so we compare the event stream.id data set by model.updateStreamInfo.
            const track = event.track,
                  trackId = track.id,
                  // event.steams[0] should be right, but let's be sure
                  stream = event.streams.find(stream =>
                                              stream.getTracks().find(track => 
                                                                      track.id === trackId))
                  || {id: 'no match'};
            log('track', 'receiving', track.kind, stream.id, this.name());
            if (stream.id === this.model[track.kind]) {
                this.displayStream(stream, 'webcam');
                // Yuck: set up a trackKind => local track.id map analogous to model[streamKind] => global stream.id
                this[track.kind] = track.id;
            } else if (stream.id === this.model.screen) {
                this.displayStream(stream, 'screen');
                this.screen = track.id; // as with above comment.
            } else { // We may have to stash and pick up later from out of order messaging between rtc and croquet.
                console.error('FIXME: COULD NOT IDENTIFY PLAYER FOR TRACK. stream:', stream.id,
                              'trackKind:', track.kind,
                              'audio:', this.model.audio,
                              'video:', this.model.video,
                              'screen:', this.model.screen);
            }
        });
    }
}

Croquet.startSession("chat", MeetingModel, MeetingView);
