import whatsapp from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import CommandHandler from './handlers/CommandHandler.js';

export default async function whatsappConnect() {

  const client = new whatsapp.Client({
    authStrategy: new whatsapp.LocalAuth()
  });

  client.on('qr', qr => {
      qrcode.generate(qr, {small: true});
  });

  client.on('ready', async() => {
      console.log('whatsapp client is ready!');

      await CommandHandler.initialize(client);

      console.log("CommandHandler is ready!");
  });

  client.on('message', message => CommandHandler.message(message));
  client.on('message_create', message => CommandHandler.message(message));

  return client.initialize();
}
