
# IZTranslator


Preface
========

Huge thank you to Jeff at Fireship for his project on WebRTC, it was the basis for the call handling (https://fireship.io/lessons/webrtc-firebase-video-chat/).
#About
This project leverages WebRTC for peer-to-peer calling, but with a twist: instead of hearing your voice in your language, AOAI will record your audio, translate it to your peer's language and output the audio to them. This realtime translation will hopefully make communicating with peers in other languages faster, easier and more natural feeling. 
#Prerequesites
- Azure Subscription (obviously)
- Deployed Azure OpenAI GPT 4o realtime model
	- gpt-4o-mini-realtime-preview or gpt-4o-realtime-preview
- Google Firestore Database and Project
	- Free tier works perfectly for this use case
	- Future CosmosDB support coming

Configuration
============
1. Clone the repository locally
2. Open in VSCode
3. Create a new `.env` file based off `sample.env` and populate it with your values
	- Once you have a project created in Firebase, you can get your connection settings from the project settings:
	
4. In terminal run
`npm install`
5. In terminal run
`npm run dev`
6. The server should show it as running and can be accessed at  http://localhost:5173/, as well as your https://yourIPaddress:5173/
	- If you want to change the port, you can edit the package.json file and change 
	`vite --host`
	to vite --host --port [PORTNUMBER]

Usage
============
On the main page, you must allow access to your camera and microphone to populate the device selectors. First select your languagem then your OAI voice you want to use. Finally, select your input and output devices. Once your choices are set, click start webcam.

If you are the host, generate a call offer token by clicking `Create Call (offer)`, send your peer the code that appears in the box below, and wait for your recipient.

As a guest, after you have done your initial configuration and started the webcam, paste the call token in the textbox and click `Answer`. You should be immediately connected!

Extending
=============
This project can be deployed to Azure Static Web Apps. The included Github workflow file shows a very simple way to do this, all you will want to do is make sure you create/edit your repository secrets to hold the values needed to connect to Firebase/AOAI.
