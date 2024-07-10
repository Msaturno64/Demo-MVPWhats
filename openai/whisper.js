const { downloadMediaMessage } = require("@adiwajshing/baileys");
const OpenAI = require("openai");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs").promises;  // Cambiado a la versión asíncrona
const path = require("path");
const axios = require("axios");  // Asegúrate de instalar axios
const FormData = require("form-data");

ffmpeg.setFfmpegPath(ffmpegPath);

require('dotenv').config();
const openaiApiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

const voiceToText = async (filePath) => {
  if (!await fs.access(filePath).then(() => true).catch(() => false)) {
    throw new Error("No se encuentra el archivo");
  }
  try {
    const form = new FormData();
    form.append("file", await fs.readFile(filePath), path.basename(filePath));
    form.append("model", "whisper-1");

    const headers = form.getHeaders();
    headers['Authorization'] = `Bearer ${openaiApiKey}`;

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: headers,
    });
    return response.data.text;
  } catch (err) {
    console.log(err.response ? err.response.data : err);
    return "ERROR";
  }
};

const convertOggMp3 = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioQuality(96)
      .toFormat("mp3")
      .save(outputPath)
      .on("progress", (p) => null)
      .on("end", () => {
        resolve(true);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
};

const handlerAI = async (ctx) => {
  const buffer = await downloadMediaMessage(ctx, "buffer");
  const tmpDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const pathTmpOgg = path.join(tmpDir, `voice-note-${Date.now()}.ogg`);
  const pathTmpMp3 = path.join(tmpDir, `voice-note-${Date.now()}.mp3`);
  
  await fs.writeFile(pathTmpOgg, buffer);
  await convertOggMp3(pathTmpOgg, pathTmpMp3);
  
  const text = await voiceToText(pathTmpMp3);
  
  await fs.unlink(pathTmpMp3).catch((error) => console.error(error));
  await fs.unlink(pathTmpOgg).catch((error) => console.error(error));
  
  return text;
};

module.exports = { handlerAI };



