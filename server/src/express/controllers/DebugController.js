import FlowModel from "../../mongo/models/FlowModel.js";
import mongoConnect from "../../mongo/mongoConnect.js";
import CommandHandler from "../../whatsapp/handlers/CommandHandler.js";


export default class DebugController {

  static async debug(req, res) {
    try {

      await mongoConnect();
      const result = await CommandHandler.debug();
      return res.status(200).json({
        debug: true,
        result: result,
      });

    } catch (error) {
      console.error("Error:", error);
      return res.status(500).send("Internal Server Error");
    }
  }
}
