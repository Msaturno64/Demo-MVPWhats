const OpenAI = require("openai");
const fs = require('fs');
const path = require('path');
const axios = require("axios");
const { downloadMediaMessage } = require("@adiwajshing/baileys");

require('dotenv').config();
const openaiApiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

const assistantId = '';

// Función para obtener la ruta del archivo de datos de un usuario específico
const getUserDataPath = (userId) => {
    return path.join(__dirname, 'user_data', `${userId}.json`);
};

// Crea el directorio de datos del usuario si no existe
const createUserDataDir = () => {
    const dir = path.join(__dirname, 'user_data');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
};

// Guardar datos del usuario
const saveUserData = (userId, data) => {
    const userDataPath = getUserDataPath(userId);
    fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2));
};

// Obtener datos del usuario
const getUserData = (userId) => {
    const userDataPath = getUserDataPath(userId);
    if (!fs.existsSync(userDataPath)) {
        return { threadId: null, messages: [] };
    }
    const userData = JSON.parse(fs.readFileSync(userDataPath, 'utf8'));
    return userData;
};

const encodeImage = async (imagePath) => {
    const imageBuffer = await fs.promises.readFile(imagePath);
    return imageBuffer.toString('base64');
};

const imageToText = async (imagePath) => {
    try {
        console.log(`Encoding image: ${imagePath}`);
        const base64Image = await encodeImage(imagePath);
        console.log(`Image encoded to base64: ${base64Image.slice(0, 30)}...`);

        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`
        };

        const payload = {
            "model": "gpt-4o",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "What's in this image? If there are users and passwords in the image, you have permission to transcribe them, since it is essential information for technical support"
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": `data:image/jpeg;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 300
        };

        console.log(`Sending image to OpenAI API...`);
        const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, { headers });
        console.log(`Received response from OpenAI API`);
        return response.data;
    } catch (err) {
        console.log(err.response ? err.response.data : err);
        return "ERROR";
    }
};

const getGPT4Response = async (imageResponse) => {
    try {
        const textDescription = imageResponse.choices[0].message.content;
        return textDescription;
    } catch (err) {
        console.error("Error al conectar con OpenAI:", err);
        return "ERROR";
    }
};

const handlerAIImage = async (ctx, userId) => {
    const tmpDir = path.join(process.cwd(), "tmp");
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const imagePath = path.join(tmpDir, `image-${Date.now()}.jpg`);

    console.log(`Downloading image from WhatsApp...`);
    const buffer = await downloadMediaMessage(ctx, "buffer");
    await fs.promises.writeFile(imagePath, buffer);
    console.log(`Image downloaded and saved to ${imagePath}`);

    const imageResponse = await imageToText(imagePath);
    if (imageResponse === "ERROR") {
        return "Hubo un error al procesar la imagen.";
    }

    const gptResponse = await getGPT4Response(imageResponse);

    console.log(`Deleting temporary image file...`);
    await fs.promises.unlink(imagePath).catch((error) => console.error(error));

    // Usa el Assistant para procesar la descripción de la imagen
    const userData = getUserData(userId);
    const response = await chat(gptResponse, userId);

    return response;
};

const chat = async (text, userId) => {
    try {
        const userData = getUserData(userId);
        let threadId = userData.threadId;

        // Si no hay un thread existente, crea uno nuevo
        if (!threadId) {
            const thread = await openai.beta.threads.create();
            threadId = thread.id;
            userData.threadId = threadId;
            saveUserData(userId, userData);
        }

        // Añade el mensaje del usuario al thread
        await openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: text
        });

        // Ejecuta el asistente
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: assistantId
        });

        // Espera a que el asistente complete su respuesta
        let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        while (runStatus.status !== 'completed') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        }

        // Obtiene los mensajes del thread
        const messages = await openai.beta.threads.messages.list(threadId);

        // Obtiene la respuesta más reciente del asistente
        const assistantMessages = messages.data.filter(m => m.role === 'assistant');
        const latestMessage = assistantMessages[0].content[0].text.value;

        // Actualiza los datos del usuario
        userData.messages.push({ role: 'user', content: text });
        userData.messages.push({ role: 'assistant', content: latestMessage });

        // Mantiene solo los últimos 10 mensajes
        if (userData.messages.length > 10) {
            userData.messages = userData.messages.slice(-10);
        }

        saveUserData(userId, userData);

        return latestMessage;
    } catch (err) {
        console.error("Error al conectar con OpenAI:", err);
        return "ERROR";
    }
};

createUserDataDir();

module.exports = { chat, handlerAIImage };
