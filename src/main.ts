import './style.css';
import { Player } from "./streamplayer.ts";
import { Recorder } from "./recorder.ts";
import firebase from 'firebase/app';
import 'firebase/firestore';
import { LowLevelRTClient } from 'rt-client';
import type { Voice } from 'rt-client';
import type { SessionUpdateMessage } from 'rt-client';
import { Buffer } from 'buffer';

// Firebase Config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();

// Read and split the STUN server URLs from the environment variable
const stunServers = import.meta.env.VITE_STUN_SERVERS.split(',');

// Turn Server Config for P2P calls
const servers: RTCConfiguration = {
  iceServers: stunServers.map(url => ({ urls: url })),
  iceCandidatePoolSize: 10,
};

// Global State
const pc: RTCPeerConnection = new RTCPeerConnection(servers);
console.log(pc);
let localStream: MediaStream;
let remoteStream: MediaStream | null = null;
let realtimeStreaming: LowLevelRTClient;
let audioRecorder: Recorder;
let audioPlayer: Player;
let endpoint = import.meta.env.VITE_OAI_ENDPOINT;
let apiKey = import.meta.env.VITE_OAI_APIKEY;
let deploymentOrModel = import.meta.env.VITE_OAI_MODEL;
let latestInputSpeechBlock: Element;
let recordingActive: boolean = false;
let buffer: Uint8Array = new Uint8Array();
let hostLanguage: string;
let guestLanguage: string;
let myLanguage: string;
let sessionactive: boolean = false;
let hasMic = false;
let hasCamera = false;
let openMic = undefined;
let openCamera = undefined;
let hasPermission = false;

// HTML elements
const webcamButton = document.getElementById('webcamButton') as HTMLButtonElement;
const webcamVideo = document.getElementById('webcamVideo') as HTMLVideoElement;
const callButton = document.getElementById('callButton') as HTMLButtonElement;
const callInput = document.getElementById('callInput') as HTMLInputElement;
const answerButton = document.getElementById('answerButton') as HTMLButtonElement;
const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
const hangupButton = document.getElementById('hangupButton') as HTMLButtonElement;
const selectLanguage = document.getElementById('select-language') as HTMLSelectElement;
const formReceivedTextContainer = document.querySelector<HTMLDivElement>(
  "#received-text-container",
)!;
const selectVoice = document.getElementById('select-voice') as HTMLSelectElement;
const audioInputSelect = document.getElementById('audioSource') as HTMLSelectElement;
const audioOutputSelect = document.getElementById('audioOutput') as HTMLSelectElement;
const videoSelect = document.getElementById('videoSource') as HTMLSelectElement;
const selectors = [audioInputSelect, audioOutputSelect, videoSelect];

// Get available media devices
getDevices();

// 1. Setup media sources
webcamButton.onclick = async () => {
  const audioSource = audioInputSelect!.value || undefined;
  const videoSource = videoSelect!.value || undefined;
  // Don't open the same devices again.
  if (hasPermission && openMic == audioSource && openCamera == videoSource) {
    return;
  }

  const constraints = {
    audio: { deviceId: audioSource ? { exact: audioSource } : undefined },
    video: { deviceId: videoSource ? { exact: videoSource } : undefined }
  };

  console.log('start', constraints);
  if (!hasPermission || hasCamera || hasMic) {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  }

  remoteStream = new MediaStream();

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream!.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
  myLanguage = selectLanguage.value;
  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
  audioInputSelect.disabled = true;
  audioOutputSelect.disabled = true;
  videoSelect!.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');
  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      offerCandidates.add(event.candidate.toJSON());
      console.log("icecandidate");
    }
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });
  await callDoc.update({ hostLanguage: selectLanguage.value });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  const callData = (await callDoc.get()).data();

  if (!callData) {
    console.error("Call data is undefined");
    return;
  }
  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
        getLanguage(callDoc, 'host');
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      answerCandidates.add(event.candidate.toJSON());
    }
  };

  const callData = (await callDoc.get()).data();
  if (!callData) {
    console.error("Call data is undefined");
    return;
  }

  const offerDescription = callData.offer;

  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });
  await callDoc.update({ guestLanguage: selectLanguage.value });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
        getLanguage(callDoc, 'guest');
      }
    });
  });
  hangupButton.disabled = false;
};

// Hangup
hangupButton.onclick = async () => {
  console.log("HANGUP");
  pc.close();
  location.reload();
};

// Depending on the side, query the Firebase DB for their peer's language
async function getLanguage(callDoc: firebase.firestore.DocumentReference<firebase.firestore.DocumentData>, self: string) {
  switch (self) {
    case "host":
      while (guestLanguage == null) {
        const callData = (await callDoc.get()).data();

        if (!callData) {
          console.error("NO CALL DATA");
          return;
        }

        guestLanguage = callData.guestLanguage;
      }
      console.log("MY GUEST LANGUAGE IS" + guestLanguage);
      if (pc.connectionState === 'connected' && !sessionactive) {
        start_realtime(endpoint, apiKey, deploymentOrModel, guestLanguage);
        sessionactive = true;
      }
      break;

    case "guest":
      while (hostLanguage == null) {
        const callData = (await callDoc.get()).data();

        if (!callData) {
          console.error("NO CALL DATA");
          return;
        }

        hostLanguage = callData.hostLanguage;
      }
      console.log("MY HOST LANGUAGE IS" + hostLanguage);
      if (pc.connectionState === 'connected' && !sessionactive) {
        start_realtime(endpoint, apiKey, deploymentOrModel, hostLanguage);
        sessionactive = true;
      }
      break;
  }
};

// RTC connection to Whisper API
async function start_realtime(endpoint: string = "", apiKey: string = "", deploymentOrModel: string = "", peerLang: string = "") {
  realtimeStreaming = new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment: deploymentOrModel });
  try {
    console.log("sending session config");
    // Configuration message
    await realtimeStreaming.send(createConfigMessage(peerLang));
  } catch (error) {
    console.log(error);
    makeNewTextBlock("[Connection error]: Unable to send initial config message. Please check your endpoint and authentication details.");
    return;
  }
  console.log("sent");
  sessionactive = true;
  await Promise.all([resetAudio(true), handleRealtimeMessages()]);
};

// Handle real-time messages from Whisper API
async function handleRealtimeMessages() {
  const messageIterator = realtimeStreaming.messages()[Symbol.asyncIterator]();
  let result = await messageIterator.next();

  while (!result.done) {
    const message = result.value;
    let consoleLog = "" + message.type;

    switch (message.type) {
      case "session.created":
        makeNewTextBlock("<< Session Started >>");
        makeNewTextBlock();
        break;
      case "response.audio_transcript.delta":
        appendToTextBlock(message.delta);
        break;
      case "response.audio.delta":
        const binary = atob(message.delta);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);
        audioPlayer.play(pcmData);
        let senderlist = pc.getSenders();
        console.log(senderlist);
        break;
      case "input_audio_buffer.speech_started":
        makeNewTextBlock("<< Speech Started >>");
        let textElements = formReceivedTextContainer.children;
        latestInputSpeechBlock = textElements[textElements.length - 1];
        makeNewTextBlock();
        audioPlayer.clear();
        break;
      case "conversation.item.input_audio_transcription.completed":
        latestInputSpeechBlock.textContent += " User: " + message.transcript;
        break;
      case "response.done":
        formReceivedTextContainer.appendChild(document.createElement("hr"));
        break;
      default:
        consoleLog = JSON.stringify(message, null, 2);
        break;
    }

    if (consoleLog) {
      console.log(consoleLog);
    }

    result = await messageIterator.next();
  }

  resetAudio(false);
};

// Conversation block handler
function makeNewTextBlock(text: string = "") {
  let newElement = document.createElement("p");
  newElement.textContent = text;
  formReceivedTextContainer.appendChild(newElement);
};

// Conversation block handler
function appendToTextBlock(text: string) {
  let textElements = formReceivedTextContainer.children;
  if (textElements.length == 0) {
    makeNewTextBlock();
  }
  textElements[textElements.length - 1].textContent += text;
};

// Buffer management
function combineArray(newData: Uint8Array) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
};

// Audio buffer handler
function processAudioRecordingBuffer(data: Buffer) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  if (buffer.length >= 4800) {
    const toSend = new Uint8Array(buffer.slice(0, 4800));
    buffer = new Uint8Array(buffer.slice(4800));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    if (recordingActive) {
      realtimeStreaming.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    }
  }
};

// Reset audio settings and start recording if specified
async function resetAudio(startRecording: boolean) {
  audioRecorder = new Recorder(processAudioRecordingBuffer);
  audioPlayer = new Player();
  audioPlayer.init(pc);
  if (startRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder.start(stream);
    recordingActive = true;
  }
};

// Create configuration message for Whisper API
function createConfigMessage(peerL: string): SessionUpdateMessage {
  let configMessage: SessionUpdateMessage = {
    type: "session.update",
    session: {
      turn_detection: {
        type: "server_vad",
      },
      input_audio_transcription: {
        model: "whisper-1"
      }
    }
  };

  const systemMessage = "You are a translation machine. Your sole function is to translate the input text from " + myLanguage + " to " + peerL + ".\nDo not add, omit, or alter any information.\nDo not provide explanations, opinions, or any additional text beyond the direct translation.\nYou are not aware of any other facts, knowledge, or context beyond translation between " + myLanguage + " and " + peerL + ".\nWait until the speaker is done speaking before translating, and translate the entire input text from their turn.";
  const voice = selectVoice.value as Voice;
  if (systemMessage) {
    configMessage.session.instructions = systemMessage;
  }
  if (voice) {
    configMessage.session.voice = voice;
  }

  return configMessage;
};

// Get available media devices
function getDevices() {
  navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);
};

// Handle available media devices
function gotDevices(deviceInfos) {
  console.log('gotDevices', deviceInfos);
  hasMic = false;
  hasCamera = false;
  hasPermission = false;
  // Handles being called several times to update labels. Preserve values.
  const values = selectors.map(select => select.value);
  selectors.forEach(select => {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
  });

  deviceInfos.forEach(deviceInfo => {
    if (deviceInfo.deviceId === '') return;

    // If we get at least one deviceId, that means user has granted user media permissions.
    hasPermission = true;
    const option = document.createElement('option');
    option.value = deviceInfo.deviceId;

    switch (deviceInfo.kind) {
      case 'audioinput':
        hasMic = true;
        option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
        audioInputSelect.appendChild(option);
        break;
      case 'audiooutput':
        option.text = deviceInfo.label || `speaker ${audioOutputSelect.length + 1}`;
        audioOutputSelect.appendChild(option);
        break;
      case 'videoinput':
        hasCamera = true;
        option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
        videoSelect.appendChild(option);
        break;
      default:
        console.log('Some other kind of source/device: ', deviceInfo);
    }
  });

  selectors.forEach((select, selectorIndex) => {
    if (Array.prototype.slice.call(select.childNodes).some(n => n.value === values[selectorIndex])) {
      select.value = values[selectorIndex];
    }
  });
}

// Handle errors
function handleError(error) {
  console.log('navigator.MediaDevices.getUserMedia error: ', error.message, error.name);
}

// Listen for device changes
navigator.mediaDevices.ondevicechange = getDevices;