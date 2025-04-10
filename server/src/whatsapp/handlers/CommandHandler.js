import FlowModel from "../../mongo/models/FlowModel.js";
import LeadModel from "../../mongo/models/LeadModel.js";
import mongoConnect from "../../mongo/mongoConnect.js";
import whatsapp from "whatsapp-web.js";

const findAllowedNodes = (
  startNodeId,
  nodes,
  edges = [],
  allowedTypes = []
) => {
  const allowedNodes = [];
  const visited = new Set();

  function dfs(nodeId) {
    const outgoingEdges = edges.filter((edge) => edge.source === nodeId);

    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);

        const currentNode = nodes.find((node) => node.id === edge.target);

        if (!allowedTypes.includes(currentNode.type)) {
          return;
        }

        allowedNodes.push(edge.target);

        dfs(edge.target);
      }
    }
  }

  dfs(startNodeId);

  return allowedNodes;
};

const replaceVariables = (data, variables) => {
  const pattern = /{([^}]+)}/g;
  const result = {};
  for (const key in data) {
    if (
      Object.prototype.hasOwnProperty.call(data, key) &&
      typeof data[key] === "string"
    ) {
      const replacedField = data[key].replace(pattern, (_, match) => {
        const variableValue = variables[match.trim()];
        return variableValue !== undefined ? variableValue : match;
      });
      result[key] = replacedField;
    }
  }
  return result;
};

class CommandHandler {
  constructor() {
    /**
     * @private
     * @type {whatsapp.Client}
     */
    this.client;

    /**
     * @private
     * @type {{nodes: [], edges: [] }}
     */
    this.flow;

    /**
     * @private
     * @type {{key: value}}
     */
    this.variables = {};

    /**
     * @private
     * @type {{ var_name: String, var_tel: String, var_lastcommand: String, var_datetime: String }}
     */
    this.userData = {};

    /**
     * @private
     * @type {String}
     */
    this.startDialog;
  }

  /**
   * @returns {CommandHandler}
   */
  static getInstance() {
    if (!CommandHandler.instance) {
      CommandHandler.instance = new CommandHandler();
    }
    return CommandHandler.instance;
  }

  /**
   * @param {whatsapp.Client} client
   */
  async initialize(client) {
    this.client = client;
    await this.rebuild(await FlowModel.findOne({}).lean());
  }

  /**
   * @returns {Promise<boolean>}
   */
  async checkClientConnection() {
    return (
      this.client &&
      (await this.client.getState()) == whatsapp.WAState.CONNECTED
    );
  }

  /**
   * @param {{nodes: [], edges: [] }}flow
   */
  async rebuild(flow) {
    this.flow = flow;

    this.startDialog = null;

    this.variables = {};

    this.userData = null;

    if (
      flow &&
      flow.nodes &&
      flow.nodes.length > 0 &&
      (await this.checkClientConnection())
    ) {
      for (const node of this.flow.nodes) {
        switch (node.type) {
          case "userNode":
            if (node.data) {
              if (!this.userData) this.userData = node.data;
            }
            break;

          case "commandNode":
            if (node.data?.command) {
              if (!this.startDialog) this.startDialog = node.data.command;
              if (node.data?.var_command)
                this.variables[node.data.var_command] = node.data.command;
              node.allowedNodes = findAllowedNodes(
                node.id,
                flow.nodes,
                flow.edges,
                ["botMessageNode"]
              );
            }
            break;

          case "managerNode":
            if (node.data?.tel && node.data?.var_tel) {
              this.variables[node.data.var_tel] = node.data.tel;
            }
            break;

          default:
            break;
        }
      }

    }
  }

  /**
   * @param {whatsapp.Message} message
   */
  async message(message) {
    try {

      // todo: delete this
      // console.log("%o", message['_data'].list.sections[0].rows);
      console.log("%o", message);
      return;
      const body = message.body;
      const contact = await message.getContact();
      const timestamp = new Date(message.timestamp * 1000);

      const flow = this.flow;

      if (flow && flow.nodes && flow.nodes.length > 0) {
        const command = flow.nodes.find((node) => body == node.data?.command);

        if (command) {

          if (this.userData) {
            this.userData.var_name &&
              (this.variables[this.userData.var_name] =
                contact.name || contact.pushname);
            this.userData.var_tel &&
              (this.variables[this.userData.var_tel] = contact.number);
            this.userData.var_lastcommand &&
              (this.variables[this.userData.var_lastcommand] = body);
            this.userData.var_datetime &&
              (this.variables[this.userData.var_datetime] =
                timestamp.toLocaleString("ru-Ru", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                }));
          }

          const replyMessages = flow.nodes.filter((node) =>
            command.allowedNodes.includes(node.id)
          );

          for (const reply of replyMessages) {
            const data = replaceVariables(reply.data, this.variables);

            const recipientNumberId = await this.client.getNumberId(
              data.recipient
            ).catch(() => { });

            if (recipientNumberId?._serialized && data?.message)
              await this.client.sendMessage(
                recipientNumberId._serialized,
                data.message
              );
          }

          await LeadModel.updateOne({
            tel: contact.number
          }, {
            name: contact.name || contact.pushname,
            lastcommand: body
          }, {
            upsert: true
          });
          return;
        }
      }

      await this.client.sendMessage(
        message.from,
        "В данный момент ведётся процесс разработки. Это сообщение сформировано автоматически." +
        (this.startDialog &&
          " Для начала диалога наберите команду " + this.startDialog)
      );
    } catch (error) { }
  }

  /**
   * 
   */
  async debug() {
    try {

      const chatId = "77789947805@c.us";
      // const content = "Тестовая строка от бота";
      const content = "";

      const interactive = {
        type: "button",
        body: {
          text: "Тестовое сообщение от бота",
        },
        footer: {
          text: "Тестовое сообщение от бота",
        },
        header: {
          text: "Тестовое сообщение от бота",
        },
        action: {
          buttons: [
            {
              name: 'quick_reply',
              id: "ButtonsV3:string",
              display_text: "string",
              buttonText: { displayText: 'button2' },
              type: 1,
              title: "string",
              buttonParamsJson: '{"fix":true,"display_text":"string","id":"ButtonsV3:string","disabled":false}'
            },
          ],
        }
      };

      let internalOptions = {
        // linkPreview: true,
        // sendAudioAsVoice: undefined,
        // sendVideoAsGif: undefined,
        // sendMediaAsSticker: undefined,
        // sendMediaAsDocument: undefined,
        // caption: "Какое то описание",
        // quotedMessageId: undefined,
        // parseVCards: true,
        // mentionedJidList: [],
        // groupMentions: undefined,
        // invokedBotWid: undefined,
        // extraOptions: undefined,
        type: 'interactive',
        // type: "button",
        // type: 'list',
        caption: 'string',
        footer: 'string',
        // title: 'string',

        nativeFlowName: 'quick_reply',
        interactiveHeader: { title: 'string', hasMediaAttachment: false },
        interactiveType: 'native_flow',
        // interactiveType: 'list',
        interactivePayload: {
          // messageVersion: 1,
          messageVersion: 1,
          '$$unknownFieldCount': 0,
          buttons: [
            {
              // type: "reply",
              // reply: {
              //   id: "unique-postback-id",
              //   title: "First Button’s Title"
              // },
              '$$unknownFieldCount': 0,
              name: 'quick_reply',
              // id: "ButtonsV3:string",
              // display_text: "string",
              // buttonText: { displayText: 'button2' },
              // type: 1,
              // title: "string",
              buttonParamsJson: JSON.stringify({
                fix:true,
                display_text:"string",
                id:"ButtonsV3:string",
                disabled:false
              })
            },
          ]
        },

        pmCampaignId: null,

        // interactive: {
        //   //   // messageVersion: 1,
        //   //   // '$$unknownFieldCount': 0,
        //   //   // type: "button",
        //   //   // body: {
        //   //   //   text: "Тестовое сообщение от бота",
        //   //   // },
        //   //   // footer: {
        //   //   //   text: "Тестовое сообщение от бота",
        //   //   // },
        //   //   // header: {
        //   //   //   type: "text",
        //   //   //   text: "Тестовое сообщение от бота",
        //   //   // },
        //   action: {
        //     // sections: [
        //     //   {
        //     //     title: "SECTION_TITLE_TEXT",
        //     //     rows: [
        //     //       {
        //     //         id: "ROW_ID",
        //     //         title: "ROW_TITLE_TEXT",
        //     //         description: "ROW_DESCRIPTION_TEXT"
        //     //       }
        //     //     ]
        //     //   }
        //     // ],
        //     // button: "BUTTON_TEXT",
        //     //     buttons: [
        //     //       {
        //     //         // type: "reply",
        //     //         // reply: {
        //     //         //   id: "unique-postback-id",
        //     //         //   title: "First Button’s Title"
        //     //         // }
        //     //         // '$$unknownFieldCount': 0,
        //     //         name: 'quick_reply',
        //     //         // id: "ButtonsV3:string",
        //     //         // display_text: "string",
        //     //         // buttonText: { displayText: 'button2' },
        //     //         // type: 1,
        //     //         // title: "string",
        //     //         buttonParamsJson: '{"fix":true,"display_text":"string","id":"ButtonsV3:string","disabled":false}'
        //     //       },
        //     //     ],
        //   }
        // },

        // list: {
        //   '$$unknownFieldCount': 0,
        //   sections: [
        //     {
        //       '$$unknownFieldCount': 0, 
        //       rows: [{
        //         '$$unknownFieldCount': 0,
        //         title: 'string',
        //         description: 'string',
        //         rowId: 'ListV3:string'
        //       }], 
        //       title: 'string'
        //     },
        //   ],
        //   title: 'string',
        //   description: 'string',
        //   buttonText: 'string',
        //   listType: 1,
        //   footerText: 'string'
        // },
      };

      const sendSeen = true;

      const newMessage = await this.client.pupPage.evaluate(async (chatId, message, options, sendSeen) => {
        const chatWid = window.Store.WidFactory.createWid(chatId);
        const chat = await window.Store.Chat.find(chatWid);

        if (sendSeen) {
          await window.WWebJS.sendSeen(chatId);
        }

        window.WWebJS.sendMessage = async (chat, content, options = {}) => {
          // let attOptions = {};
          // if (options.attachment) {
          //   attOptions = options.sendMediaAsSticker
          //     ? await window.WWebJS.processStickerData(options.attachment)
          //     : await window.WWebJS.processMediaData(options.attachment, {
          //       forceVoice: options.sendAudioAsVoice,
          //       forceDocument: options.sendMediaAsDocument,
          //       forceGif: options.sendVideoAsGif
          //     });

          //   attOptions.caption = options.caption;
          //   content = options.sendMediaAsSticker ? undefined : attOptions.preview;
          //   attOptions.isViewOnce = options.isViewOnce;

          //   delete options.attachment;
          //   delete options.sendMediaAsSticker;
          // }

          // let quotedMsgOptions = {};
          // if (options.quotedMessageId) {
          //   let quotedMessage = await window.Store.Msg.getMessagesById([options.quotedMessageId]);

          //   if (quotedMessage['messages'].length != 1) {
          //     throw new Error('Could not get the quoted message.');
          //   }

          //   quotedMessage = quotedMessage['messages'][0];

          //   // TODO remove .canReply() once all clients are updated to >= v2.2241.6
          //   const canReply = window.Store.ReplyUtils ?
          //     window.Store.ReplyUtils.canReplyMsg(quotedMessage.unsafe()) :
          //     quotedMessage.canReply();

          //   if (canReply) {
          //     quotedMsgOptions = quotedMessage.msgContextInfo(chat);
          //   }
          //   delete options.quotedMessageId;
          // }

          // if (options.mentionedJidList) {
          //   options.mentionedJidList = await Promise.all(
          //     options.mentionedJidList.map(async (id) => {
          //       const wid = window.Store.WidFactory.createWid(id);
          //       if (await window.Store.QueryExist(wid)) {
          //         return wid;
          //       }
          //     })
          //   );
          //   options.mentionedJidList = options.mentionedJidList.filter(Boolean);
          // }

          // if (options.groupMentions) {
          //   options.groupMentions = options.groupMentions.map((e) => ({
          //     groupSubject: e.subject,
          //     groupJid: window.Store.WidFactory.createWid(e.id)
          //   }));
          // }

          // let locationOptions = {};
          // if (options.location) {
          //   let { latitude, longitude, description, url } = options.location;
          //   url = window.Store.Validators.findLink(url)?.href;
          //   url && !description && (description = url);
          //   locationOptions = {
          //     type: 'location',
          //     loc: description,
          //     lat: latitude,
          //     lng: longitude,
          //     clientUrl: url
          //   };
          //   delete options.location;
          // }

          // let _pollOptions = {};
          // if (options.poll) {
          //   const { pollName, pollOptions } = options.poll;
          //   const { allowMultipleAnswers, messageSecret } = options.poll.options;
          //   _pollOptions = {
          //     type: 'poll_creation',
          //     pollName: pollName,
          //     pollOptions: pollOptions,
          //     pollSelectableOptionsCount: allowMultipleAnswers ? 0 : 1,
          //     messageSecret:
          //       Array.isArray(messageSecret) && messageSecret.length === 32
          //         ? new Uint8Array(messageSecret)
          //         : window.crypto.getRandomValues(new Uint8Array(32))
          //   };
          //   delete options.poll;
          // }

          // let vcardOptions = {};
          // if (options.contactCard) {
          //   let contact = window.Store.Contact.get(options.contactCard);
          //   vcardOptions = {
          //     body: window.Store.VCard.vcardFromContactModel(contact).vcard,
          //     type: 'vcard',
          //     vcardFormattedName: contact.formattedName
          //   };
          //   delete options.contactCard;
          // } else if (options.contactCardList) {
          //   let contacts = options.contactCardList.map(c => window.Store.Contact.get(c));
          //   let vcards = contacts.map(c => window.Store.VCard.vcardFromContactModel(c));
          //   vcardOptions = {
          //     type: 'multi_vcard',
          //     vcardList: vcards,
          //     body: undefined
          //   };
          //   delete options.contactCardList;
          // } else if (options.parseVCards && typeof (content) === 'string' && content.startsWith('BEGIN:VCARD')) {
          //   delete options.parseVCards;
          //   try {
          //     const parsed = window.Store.VCard.parseVcard(content);
          //     if (parsed) {
          //       vcardOptions = {
          //         type: 'vcard',
          //         vcardFormattedName: window.Store.VCard.vcardGetNameFromParsed(parsed)
          //       };
          //     }
          //   } catch (_) {
          //     // not a vcard
          //   }
          // }

          // if (options.linkPreview) {
          //   delete options.linkPreview;
          //   const link = window.Store.Validators.findLink(content);
          //   if (link) {
          //     let preview = await window.Store.LinkPreview.getLinkPreview(link);
          //     if (preview && preview.data) {
          //       preview = preview.data;
          //       preview.preview = true;
          //       preview.subtype = 'url';
          //       options = { ...options, ...preview };
          //     }
          //   }
          // }

          // let buttonOptions = {};
          // if (options.buttons) {
          //   let caption;
          //   if (options.buttons.type === 'chat') {
          //     content = options.buttons.body;
          //     caption = content;
          //   } else {
          //     caption = options.caption ? options.caption : ' '; //Caption can't be empty
          //   }
          //   buttonOptions = {
          //     productHeaderImageRejected: false,
          //     isFromTemplate: false,
          //     isDynamicReplyButtonsMsg: true,
          //     title: options.buttons.title ? options.buttons.title : undefined,
          //     footer: options.buttons.footer ? options.buttons.footer : undefined,
          //     dynamicReplyButtons: options.buttons.buttons,
          //     replyButtons: options.buttons.buttons,
          //     caption: caption
          //   };
          //   delete options.buttons;
          // }

          // let listOptions = {};
          // if (options.list) {
          //   if (window.Store.Conn.platform === 'smba' || window.Store.Conn.platform === 'smbi') {
          //     throw '[LT01] Whatsapp business can\'t send this yet';
          //   }
          //   listOptions = {
          //     type: 'list',
          //     footer: options.list.footer,
          //     list: {
          //       ...options.list,
          //       listType: 1
          //     },
          //     body: options.list.description
          //   };
          //   delete options.list;
          //   delete listOptions.list.footer;
          // }

          // const botOptions = {};
          // if (options.invokedBotWid) {
          //   botOptions.messageSecret = window.crypto.getRandomValues(new Uint8Array(32));
          //   botOptions.botMessageSecret = await window.Store.BotSecret.genBotMsgSecretFromMsgSecret(botOptions.messageSecret);
          //   botOptions.invokedBotWid = window.Store.WidFactory.createWid(options.invokedBotWid);
          //   botOptions.botPersonaId = window.Store.BotProfiles.BotProfileCollection.get(options.invokedBotWid).personaId;
          //   delete options.invokedBotWid;
          // }

          const meUser = window.Store.User.getMaybeMeUser();
          const newId = await window.Store.MsgKey.newId();

          const newMsgId = new window.Store.MsgKey({
            from: meUser,
            to: chat.id,
            id: newId,
            participant: chat.id.isGroup() ? meUser : undefined,
            selfDir: 'out',
          });

          const extraOptions = options.extraOptions || {};
          delete options.extraOptions;

          const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);

          const message = {
            ...options,
            id: newMsgId,
            ack: 3,
            // body: content,
            notifyName: 'Talgat Energy Sphere',
            from: meUser,
            to: chat.id,
            author: '77789947805:26@c.us',
            local: true,
            self: 'out',
            invis: false,
            recvFresh: true,
            viewMode: 'VISIBLE',
            t: parseInt(new Date().getTime() / 1000),
            isNewMsg: true,
            // type: 'chat',
            // ...ephemeralFields,
            // ...locationOptions,
            // ..._pollOptions,
            // ...attOptions,
            // ...(attOptions.toJSON ? attOptions.toJSON() : {}),
            // ...quotedMsgOptions,
            // ...vcardOptions,
            // ...buttonOptions,
            // ...listOptions,
            // ...botOptions,
            // ...extraOptions
          };

          // return message;

          // Bot's won't reply if canonicalUrl is set (linking)
          // if (botOptions) {
          //   delete message.canonicalUrl;
          // }

          // return window.Store.SendMessage.addAndSendMsgToChat.toString();
          await window.Store.SendMessage.addAndSendMsgToChat(chat, message);
          // return result;
          return window.Store.Msg.get(newMsgId._serialized);
        }

        const msg = await window.WWebJS.sendMessage(chat, message, options, sendSeen);
        // return window.WWebJS.sendMessage.toString();
        return window.WWebJS.getMessageModel(msg);
        return msg;
      }, chatId, content, internalOptions, sendSeen);

      // const chats = await this.client.getChats();

      // const chat = await this.client.getChatById("120363398488102418@g.us");

      // const messages = await chat.fetchMessages({
      //   limit: 10,
      //   fromMe: false,
      // });

      return {
        newMessage: newMessage,
        // chats: chats,
        // messages: messages,
      };
    } catch (error) {
      console.error("Error in debug:", error);
      return {
        error: error,
      };
    }
  }
}

export default CommandHandler.getInstance();
