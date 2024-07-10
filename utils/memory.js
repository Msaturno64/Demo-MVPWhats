const path = require("path");
const fs = require("fs");
const { chat } = require('../openai/imagen-text');

const promptPath = path.join(__dirname, "mensajes", "system-prompt.txt");
const sysprompt = fs.readFileSync(promptPath, "utf8");

const userTimers = {};
const userMessages = {};

const resetTimer = (userId, callback) => {
    if (userTimers[userId]) {
        clearTimeout(userTimers[userId]);
    }
    userTimers[userId] = setTimeout(callback, 15 * 1000); // 30 segundos
};

const handleGPTResponse = async (userId, ctxFn) => {
    const prompt = sysprompt;
    const text = userMessages[userId].join('\n'); // Unir todos los mensajes del usuario
    const response = await chat(prompt, text, userId);
    await ctxFn.flowDynamic(response);
    userMessages[userId] = []; // Limpiar el historial después de enviar
};

const handleUserMessage = async (ctx, ctxFn, message) => {
    const userId = ctx.from;
    if (!userMessages[userId]) {
        userMessages[userId] = [];
    }
    userMessages[userId].push(message); // Agregar mensaje al historial
    resetTimer(userId, async () => {
        await handleGPTResponse(userId, ctxFn);
    });
};


module.exports = { handleGPTResponse, handleUserMessage, resetTimer };