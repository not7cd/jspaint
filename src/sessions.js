// REFACTORING
// glossary:
// session_id has 2 meanings
// in local session is a documentId
// in multi session is a roomId
// 		documentId should be generated localy
// 		roomId should be generated by server
// 
// 
// import { firestore } from "firebase";
// // Required for side-effects
// import "firebase/firestore";

'use strict';
(() => {

        const log = (...args) => {
            window.console && console.log(...args);
        };

        const configuration = {
            iceServers: [{
                urls: [
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                ],
            }, ],
            iceCandidatePoolSize: 10,
        };

        let localStorageAvailable = false;
        try {
            localStorage._available = true;
            localStorageAvailable = localStorage._available;
            delete localStorage._available;
            // eslint-disable-next-line no-empty
        } catch (e) {}

        // @TODO: keep other data in addition to the image data
        // such as the file_name and other state
        // (maybe even whether it's considered saved? idk about that)
        // I could have the image in one storage slot and the state in another


        const canvas_has_any_apparent_image_data = () =>
            canvas.ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v) => v > 0);

        let $recovery_window;

        function show_recovery_window(no_longer_blank) {
            $recovery_window && $recovery_window.close();
            const $w = $recovery_window = $FormToolWindow();
            $w.on("close", () => {
                $recovery_window = null;
            });
            $w.title("Recover Document");
            let backup_impossible = false;
            try { window.localStorage } catch (e) { backup_impossible = true; }
            $w.$main.append($(`
			<h1>Woah!</h1>
			<p>Your browser may have cleared the canvas due to memory usage.</p>
			<p>Undo to recover the document, and remember to save with <b>File > Save</b>!</p>
			${
				backup_impossible ?
					"<p><b>Note:</b> No automatic backup is possible unless you enable Cookies in your browser.</p>"
					: (
						no_longer_blank ?
							`<p>
								<b>Note:</b> normally a backup is saved automatically,<br>
								but autosave is paused while this dialog is open<br>
								to avoid overwriting the (singular) backup.
							</p>
							<p>
								(See <b>File &gt; Manage Storage</b> to view backups.)
							</p>`
							: ""
					)
				}
			}
		`));
		
		const $undo = $w.$Button("Undo", ()=> {
			undo();
		});
		const $redo = $w.$Button("Redo", ()=> {
			redo();
		});
		const update_buttons_disabled = ()=> {
			$undo.attr("disabled", undos.length < 1);
			$redo.attr("disabled", redos.length < 1);
		};
		$G.on("session-update.session-hook", update_buttons_disabled);
		update_buttons_disabled();

		$w.$Button("Close", ()=> {
			$w.close();
		});
		$w.center();
	}

	let last_undos_length = undos.length;
	function handle_data_loss() {
		const window_is_open = $recovery_window && !$recovery_window.closed;
		let save_paused = false;
		if (!canvas_has_any_apparent_image_data()) {
			if (!window_is_open) {
				show_recovery_window();
			}
			save_paused = true;
		} else if (window_is_open) {
			if (undos.length > last_undos_length) {
				show_recovery_window(true);
			}
			save_paused = true;
		}
		last_undos_length = undos.length;
		return save_paused;
	}
	
	class LocalSession {
		// this class handles saving/loading to local storage, and nothing else
		constructor(session_id) {
			this.session_id = session_id;
			const lsid = `image#${session_id}`;
			log(`Local storage ID: ${lsid}`);
			// hookup autosave for image to local storage
			const save_image_to_storage = debounce(() => {
				const save_paused = handle_data_loss();
				if (save_paused) {
					return;
				}
				storage.set(lsid, canvas.toDataURL("image/png"), err => {
					if (err) {
						if (err.quotaExceeded) {
							storage_quota_exceeded();
						}
						else {
							// e.g. localStorage is disabled
							// (or there's some other error?)
							// TODO: show warning with "Don't tell me again" type option
						}
					}
				});
			}, 100);
			storage.get(lsid, (err, uri) => {
				if (err) {
					if (localStorageAvailable) {
						show_error_message("Failed to retrieve image from local storage:", err);
					}
					else {
						// TODO: DRY with storage manager message
						show_error_message("Please enable local storage in your browser's settings for local backup. It may be called Cookies, Storage, or Site Data.");
					}
				}
				else if (uri) {
					open_from_URI(uri, err => {
						if (err) {
							return show_error_message("Failed to open image from local storage:", err);
						}
						saved = false; // it may be safe, sure, but you haven't "Saved" it
					});
				}
				else {
					// no uri so lets save the blank canvas
					save_image_to_storage();
				}
			});
			$G.on("session-update.session-hook", save_image_to_storage);
		}
		end() {
			// Remove session-related hooks
			$G.off(".session-hook");
		}
	}


	// The user ID is not persistent
	// A person can enter a session multiple times,
	// and is always given a new user ID
	let user_id;
	// @TODO: I could make the color persistent, though.
	// You could still have multiple cursors and they would just be the same color.
	// There could also be an option to change your color

	// The data in this object is stored in the server when you enter a session
	// It is (supposed to be) removed when you leave
	const user = {
		// Cursor status
		cursor: {
			// cursor position in canvas coordinates
			x: 0, y: 0,
			// whether the user is elsewhere, such as in another tab
			away: true,
		},
		// Currently selected tool (@TODO)
		// not7cd: move to cursor, hell everything ihere is a cursor property
		tool: "Pencil",
		// Color components
		hue: ~~(Math.random() * 360),
		saturation: ~~(Math.random() * 50) + 50,
		lightness: ~~(Math.random() * 40) + 50,
	};

	// TODO: make this a method or something
	// The main cursor color
	user.color = `hsla(${user.hue}, ${user.saturation}%, ${user.lightness}%, 1)`;
	// Unused
	user.color_transparent = `hsla(${user.hue}, ${user.saturation}%, ${user.lightness}%, 0.5)`;
	// (@TODO) The color used in the toolbar indicating to other users it is selected by this user
	user.color_desaturated = `hsla(${user.hue}, ${~~(user.saturation*0.4)}%, ${user.lightness}%, 0.8)`;


	// The image used for other people's cursors
	const cursor_image = new Image();
	cursor_image.src = "images/cursors/default.png";


	class MultiUserSession {
		// this is hell
		constructor(session_id) {
			this.session_id = session_id;
			this._fb_listeners = [];
			this.cursorChannel = null;

			file_name = `[Loading ${this.session_id}]`;
			update_title();
			const on_firebase_loaded = () => {
				file_name = `creating room`;
				update_title();

				this.start();

			};
			if (!MultiUserSession.fb_root) {
				
				// TODO: Move outide ;-;
				// const config = {
				// 	apiKey: "AIzaSyBgau8Vu9ZE8u_j0rp-Lc044gYTX5O3X9k",
				// 	authDomain: "jspaint.firebaseapp.com",
				// 	databaseURL: "https://jspaint.firebaseio.com",
				// 	projectId: "firebase-jspaint",
				// 	storageBucket: "",
				// 	messagingSenderId: "63395010995"
				// };
				// firebase.initializeApp(configuration);
				// why MultiUserSession and not this?
				// MultiUserSession.fb_root = firebase.database().ref("/");
				this.db = firebase.firestore();  // lets rewrite fb_root and others to use this one
				on_firebase_loaded();
				
			}
			else {
				on_firebase_loaded();
			}
		}
		start() {
			// TODO: how do you actually detect if it's failing???
			const $w = $FormToolWindow().title("Warning").addClass("dialogue-window");
			$w.$main.html("<p>The document may not load. Changes may not save.</p>" +
				"<p>Multiuser sessions are public. There is no security.</p>"
				// "<p>The document may not load. Changes may not save. If it does save, it's public. There is no security.</p>"// +
				// "<p>I haven't found a way to detect Firebase quota limits being exceeded, " +
				// "so for now I'm showing this message regardless of whether it's working.</p>" +
				// "<p>If you're interested in using multiuser mode, please thumbs-up " +
				// "<a href='https://github.com/1j01/jspaint/issues/68'>this issue</a> to show interest, and/or subscribe for updates.</p>"
			);
			$w.$main.css({ maxWidth: "500px" });
			$w.$Button("OK", () => {
				$w.close();
			});
			$w.center();
			
			// TODO: data handling
			// TODO: user handling

			// TODO: signal user left
			// TODO: for every other user create cursor
			
			if (this.session_id === null) {
				this.createRoom();
			} else {
				this.joinRoom();
			}
			let previous_uri;
			// let pointer_operations = []; // the multiplayer syncing stuff is a can of worms, so this is disabled
			// TODO: this should be peer to peer
			const write_canvas_to_database = debounce(() => {
				const save_paused = handle_data_loss();
				if (save_paused) {
					return;
				}
				// Sync the data from this client to the server (one-way)
				const uri = canvas.toDataURL();
				if (previous_uri !== uri) {
					// log("clear pointer operations to set data", pointer_operations);
					// pointer_operations = [];
					log("Write canvas data to Firebase");
					// this.fb_data.set(uri);
					previous_uri = uri;
				}
				else {
					log("(Don't write canvas data to Firebase; it hasn't changed)");
				}
			}, 100);
			let ignore_session_update = false;
			$G.on("session-update.session-hook", ()=> {
				if (ignore_session_update) {
					log("(Ignore session-update from Sync Session undoable)");
					return;
				}
				write_canvas_to_database();
			});

			// TODO: handle new room creation
			// TODO: handle fetching canvas from non-empty room
			// TODO: add callbacks for movemouse and blur evenrs
			// @FIXME: the cursor can come back from "away" via a pointer event
			// while the window is blurred and stay there when the user goes away
			// maybe replace "away" with a timestamp of activity and then
			// clients can decide whether a given cursor should be visible

			/*
			const debug_event = (e, synthetic) => {
				// const label = synthetic ? "(synthetic)" : "(normal)";
				// window.console && console.debug && console.debug(e.type, label);
			};
			
			$canvas_area.on("pointerdown.session-hook", "*", (e, synthetic) => {
				debug_event(e, synthetic);
				if(synthetic){ return; }

					pointer_operations = [e];
					const pointermove = (e, synthetic) => {
						debug_event(e, synthetic);
						if(synthetic){ return; }
						
						pointer_operations.push(e);
					};
					$G.on("pointermove.session-hook", pointermove);
					$G.one("pointerup.session-hook", (e, synthetic) => {
						debug_event(e, synthetic);
						if(synthetic){ return; }
						
						$G.off("pointermove.session-hook", pointermove);
					});
				}
			});
			*/

		}
		end() {
			// Remove session-related hooks
			$G.off(".session-hook");
			// $canvas_area.off("pointerdown.session-hook");
			// Remove collected Firebase event listeners
			// this._fb_listeners.forEach(({ fb, event_type, callback/*, error_callback*/ }) => {
			// 	log(`Remove listener for ${fb.path.toString()} .on ${event_type}`);
			// 	fb.off(event_type, callback);
			// });
			// this._fb_listeners.length = 0;
			// // Remove the user from the session
			// this.local_user.remove();
			// // Remove any cursor elements
			// $app.find(".user-cursor").remove();
			// Reset to "untitled"
			reset_file();
		}

		async createRoom() {
			// document.querySelector('#createBtn').disabled = true;
			// document.querySelector('#joinBtn').disabled = true;
			const db = this.db;
			const roomRef = await db.collection('rooms').doc();
		
			console.log('Create PeerConnection with configuration: ', configuration);
			this._peerConnection = new RTCPeerConnection(configuration);
		
			registerPeerConnectionListeners(this._peerConnection);

			const dataChannelParams = {ordered: true};
			// create datachannel to share position
			this.cursorChannel = this._peerConnection
				.createDataChannel('cursor-channel', dataChannelParams);
			this.cursorChannel.binaryType = 'arraybuffer';
			this.cursorChannel.addEventListener('open', () => {
				console.log('Local channel open!');
				this.connected = true;
			});
			this.cursorChannel.addEventListener('close', () => {
				console.log('Local channel closed!');
				this.connected = false;
			});
			this.cursorChannel.addEventListener('message', e => {console.log(`Remote message received by local: ${e.data}`);});

			$G.on("pointermove.session-hook", e => {
				const m = to_canvas_coords(e);
				const c = {
					x: m.x,
					y: m.y,
					away: false,
				}
				log(c);
				if (this.connected) {
					sendMessage(this.cursorChannel, JSON.stringify(c));
				} else {
					log("Not connected, won't send boi")
				}
				// this.local_user.child("cursor").update(c);
			});
		
			// Code for collecting ICE candidates below
			const callerCandidatesCollection = roomRef.collection('callerCandidates');
		
			this._peerConnection.addEventListener('icecandidate', event => {
				if (!event.candidate) {
					console.log('Got final candidate!');
					return;
				}
				console.log('Got candidate: ', event.candidate);
				callerCandidatesCollection.add(event.candidate.toJSON());
			});
			// Code for collecting ICE candidates above
		
			// Code for creating a room below
			const offer = await this._peerConnection.createOffer();
			await this._peerConnection.setLocalDescription(offer);
			console.log('Created offer:', offer);
		
			const roomWithOffer = {
				'offer': {
					type: offer.type,
					sdp: offer.sdp,
				},
			};
			await roomRef.set(roomWithOffer);
			this.session_id = roomRef.id;
			console.log(`New room created with SDP offer. Room ID: ${roomRef.id}`);
			// document.querySelector(
			// 	'#currentRoom').innerText = `Current room is ${roomRef.id} - You are the caller!`;
			// Code for creating a room above
		
			// this._peerConnection.addEventListener('track', event => {
			// 	console.log('Got remote track:', event.streams[0]);
			// 	event.streams[0].getTracks().forEach(track => {
			// 		console.log('Add a track to the remoteStream:', track);
			// 		remoteStream.addTrack(track);
			// 	});
			// });
		
			// Listening for remote session description below
			roomRef.onSnapshot(async snapshot => {
				const data = snapshot.data();
				if (!this._peerConnection.currentRemoteDescription && data && data.answer) {
					console.log('Got remote description: ', data.answer);
					const rtcSessionDescription = new RTCSessionDescription(data.answer);
					await this._peerConnection.setRemoteDescription(rtcSessionDescription);
				}
			});
			// Listening for remote session description above
		
			// Listen for remote ICE candidates below
			roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
				snapshot.docChanges().forEach(async change => {
					if (change.type === 'added') {
						let data = change.doc.data();
						console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
						await this._peerConnection.addIceCandidate(new RTCIceCandidate(data));
					}
				});
			});
			// Listen for remote ICE candidates above

			file_name = `[${this.session_id}]`;
			location.hash = `room:${this.session_id}`;
			log("filename eee", file_name);
			update_title();
		}


 		joinRoom() {
			// document.querySelector('#createBtn').disabled = true;
			// document.querySelector('#joinBtn').disabled = true;

			// document.querySelector('#confirmJoinBtn').
			// addEventListener('click', async() => {
			// 	this.session_id = document.querySelector('#room-id').value;
			// 	console.log('Join room: ', this.session_id);
			// 	document.querySelector(
			// 		'#currentRoom').innerText = `Current room is ${this.session_id} - You are the callee!`;
			// 	}, { once: true });
			// 	roomDialog.open();
			this.joinRoomById(this.session_id);
		}

		async joinRoomById(roomId) {
			const db = firebase.firestore();
			const roomRef = db.collection('rooms').doc(`${roomId}`);
			const roomSnapshot = await roomRef.get();
			console.log('Got room:', roomSnapshot.exists);

			if (roomSnapshot.exists) {
				console.log('Create PeerConnection with configuration: ', configuration);
				this._peerConnection = new RTCPeerConnection(configuration);
				registerPeerConnectionListeners(this._peerConnection);
				// localStream.getTracks().forEach(track => {
				// 	peerConnection.addTrack(track, localStream);
				// });

				// Code for collecting ICE candidates below
				const calleeCandidatesCollection = roomRef.collection('calleeCandidates');
				this._peerConnection.addEventListener('icecandidate', event => {
					if (!event.candidate) {
						console.log('Got final candidate!');
						return;
					}
					console.log('Got candidate: ', event.candidate);
					calleeCandidatesCollection.add(event.candidate.toJSON());
				});
				// Code for collecting ICE candidates above

				// this.peerConnection.addEventListener('track', event => {
				// 	console.log('Got remote track:', event.streams[0]);
				// 	event.streams[0].getTracks().forEach(track => {
				// 		console.log('Add a track to the remoteStream:', track);
				// 		remoteStream.addTrack(track);
				// 	});
				// });

				this._peerConnection.addEventListener('datachannel', event => {
					console.log(`onRemoteDataChannel: ${JSON.stringify(event)}`);
					this._peerConnection = event.channel;
					this._peerConnection.binaryType = 'arraybuffer';
					this._peerConnection.addEventListener('message', m => {
						log(JSON.parse(m.data));
					});
					this._peerConnection.addEventListener('close', () => {
					console.log('Remote channel closed!');
					this.connected = false;
					});
				});

				// Code for creating SDP answer below
				const offer = roomSnapshot.data().offer;
				console.log('Got offer:', offer);
				await this._peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
				const answer = await this._peerConnection.createAnswer();
				console.log('Created answer:', answer);
				await this._peerConnection.setLocalDescription(answer);

				const roomWithAnswer = {
					answer: {
						type: answer.type,
						sdp: answer.sdp,
					},
				};
				await roomRef.update(roomWithAnswer);
				// Code for creating SDP answer above

				// Listening for remote ICE candidates below
				roomRef.collection('callerCandidates').onSnapshot(snapshot => {
					snapshot.docChanges().forEach(async change => {
						if (change.type === 'added') {
							let data = change.doc.data();
							console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
							await this._peerConnection.addIceCandidate(new RTCIceCandidate(data));
						}
					});
				});
				// Listening for remote ICE candidates above
			}
		}

	};


	function sendMessage(channel, m) {
		channel.send(m);
	};
	// Handle the starting, switching, and ending of sessions from the location.hash

	let current_session;
	const end_current_session = () => {
		if(current_session){
			log("Ending current session");
			current_session.end();
			current_session = null;
		}
	};
	const generate_session_id = () => (Math.random()*(2 ** 32)).toString(16).replace(".", "");
	const update_session_from_location_hash = () => {
		const session_match = location.hash.match(/^#?(room|session|local):(.*)$/i);
		const load_from_url_match = location.hash.match(/^#?(load):(.*)$/i);
		if(session_match){
			const is_room = session_match[1].toLowerCase() === "room";
			const local = session_match[1].toLowerCase() === "local";
			const session_id = session_match[2];
			if (is_room) {
				if (session_id === "new") {
					current_session = new MultiUserSession(null);
				} else {
					current_session = new MultiUserSession(session_id);
				}
			}
			if(session_id === ""){
				log("Invalid session ID; session ID cannot be empty");
				end_current_session();
			}else if(!local && session_id.match(/[./[\]#$]/)){
				log("Session ID is not a valid Firebase location; it cannot contain any of ./[]#$");
				end_current_session();
			}else if(!session_id.match(/[-0-9A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02af\u1d00-\u1d25\u1d62-\u1d65\u1d6b-\u1d77\u1d79-\u1d9a\u1e00-\u1eff\u2090-\u2094\u2184-\u2184\u2488-\u2490\u271d-\u271d\u2c60-\u2c7c\u2c7e-\u2c7f\ua722-\ua76f\ua771-\ua787\ua78b-\ua78c\ua7fb-\ua7ff\ufb00-\ufb06]+/)){
				log("Invalid session ID; it must consist of 'alphanumeric-esque' characters");
				end_current_session();
			}else if(
				current_session && current_session.id === session_id && 
				local === (current_session instanceof LocalSession)
			){
				log("Hash changed but the session ID and session type are the same");
			}else{
				// @TODO: Ask if you want to save before starting a new session
				end_current_session();
				if(local){
					log(`Starting a new LocalSession, ID: ${session_id}`);
					current_session = new LocalSession(session_id);
				}else{
					// Multiuser session shouldn't get predefined session_id
					//
					log(`Starting a new MultiUserSession, ID: ${session_id}`);
					current_session = new MultiUserSession(session_id);
				}
			}
		}else if(load_from_url_match){
			const url = decodeURIComponent(load_from_url_match[2]);
			const hash_loading_url_from = location.hash;

			const uris = get_URIs(url);
			if (uris.length === 0) {
				show_error_message("Invalid URL to load (after #load: in the address bar). It must include a protocol (https:// or http://)");
				return;
			}
			end_current_session();

			// TODO: fix loading duplicately, from popstate and hashchange
			open_from_URI(url, err => {
				if(err){
					show_resource_load_error_message();
				}
				// TODO: saved = false;?
				// NOTE: the following is intended to run regardless of error (as opposed to returning if there's an error)
				// FIXME: race condition (make the timeout long and try to fix it with a flag or something )
				setTimeout(() => {
					// NOTE: this "change" event doesn't *guarantee* there was a change :/
					// let alone that there was a user interaction with the currently loaded document
					// that is, it also triggers for session changes, which I'm trying to avoid here
					$canvas.one("change", () => {
						if(location.hash === hash_loading_url_from){
							log("Switching to new session from #load: URL (to #local: URL with session ID) because of user interaction");
							end_current_session();
							const new_session_id = generate_session_id();
							location.hash = `local:${new_session_id}`;
						}
					});
				}, 100);
			});

		}else{
			log("No session ID in hash");
			const old_hash = location.hash;
			end_current_session();
			const new_session_id = generate_session_id();
			history.replaceState(null, document.title, `#local:${new_session_id}`);
			log("After replaceState:", location.hash);
			if (old_hash === location.hash) {
				// e.g. on Wayback Machine
				show_error_message("Autosave is disabled. Failed to update URL to start session.");
			} else {
				update_session_from_location_hash();
			}
		}
	};

	$G.on("hashchange popstate", e => {
		log(e.type, location.hash);
		// update_session_from_location_hash();
	});
	log("Initializing with location hash:", location.hash);
	update_session_from_location_hash();

	// @TODO: Session GUI
	// @TODO: Indicate when the session ID is invalid
	// @TODO: Indicate when the session switches

	// @TODO: Indicate when there is no session!
	// Probably in app.js so as to handle the possibility of sessions.js failing to load.

	function registerPeerConnectionListeners(peerConnection) {
		peerConnection.addEventListener('icegatheringstatechange', () => {
			console.log(
				`ICE gathering state changed: ${peerConnection.iceGatheringState}`);
		});
	
		peerConnection.addEventListener('connectionstatechange', () => {
			console.log(`Connection state change: ${peerConnection.connectionState}`);
		});
	
		peerConnection.addEventListener('signalingstatechange', () => {
			console.log(`Signaling state change: ${peerConnection.signalingState}`);
		});
	
		peerConnection.addEventListener('iceconnectionstatechange ', () => {
			console.log(
				`ICE connection state change: ${peerConnection.iceConnectionState}`);
		});
	}
})();