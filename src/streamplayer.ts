// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export class Player {
  private playbackNode: AudioWorkletNode | null = null;
    private audioContext: AudioContext;
    private mediaStream: MediaStream | null = null;
    private mediaStreamDestination: MediaStreamAudioDestinationNode;
    private isWorkletLoaded = false;

  constructor(sampleRate = 24000) {
      this.audioContext = new AudioContext({ sampleRate });
      this.mediaStreamDestination = 
          this.audioContext.createMediaStreamDestination();
  }
  
  async init(pc: RTCPeerConnection) {
    if (!this.isWorkletLoaded) {
      try {
          await this.audioContext.resume();
          await this.audioContext.audioWorklet.addModule("playback-worklet.js");
          this.playbackNode = new AudioWorkletNode(this.audioContext, 'playback-worklet');
          //this.playbackNode.connect(audioContext.destination);
          this.playbackNode.connect(this.mediaStreamDestination);
          this.mediaStreamDestination.stream.getTracks().forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === track.kind);
          sender?.replaceTrack(track);
          });
          this.isWorkletLoaded = true;
          console.log('AudioWorkletProcessor loaded');
      } catch (err) {
          console.error('Failed to load AudioWorkletProcessor:', err);
      }
  }
}

  play(buffer: Int16Array) {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(buffer);
      console.log("message added to worklet node");
      
      }
    else{
      console.log("playback node is null");
    }
  }

  clear() {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(null);
    }
  }

// stream(buffer: Int16Array, pc: RTCPeerConnection) {

//     this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
//     // this.workletNode = new AudioWorkletNode(
//     //   this.audioContext,
//     //   "playback-worklet",
//     // );
//       this.playbackNode.connect(this.mediaStreamDestination);
//       this.playbackNode.port.postMessage(buffer);
//       console.log("message added to worklet node");
//       this.mediaStreamDestination.stream.getTracks().forEach((track) => {
//         console.log(track)
//             pc.addTrack(track, this.mediaStreamDestination.stream);
//           });
//      } catch (error) {
//     this.stop();
//   }
// }

stop() {
  if (this.mediaStream) {
    this.mediaStream.getTracks().forEach((track) => track.stop());
  }
  if (this.audioContext) {
    this.audioContext.close();
  }
}

}