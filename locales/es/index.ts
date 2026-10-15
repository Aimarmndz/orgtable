// One language: its metadata and its messages by area. This file is the same in every
// language folder; when adding a language, copy it as is.
import language from "./language.json";
import common from "./common.json";
import auth from "./auth.json";
import legal from "./legal.json";
import nav from "./nav.json";
import settings from "./settings.json";
import admin from "./admin.json";
import search from "./search.json";
import boards from "./boards.json";
import errors from "./errors.json";
import notifications from "./notifications.json";
import landing from "./landing.json";
import workspaces from "./workspaces.json";
import emails from "./emails.json";
import webhooks from "./webhooks.json";
import backups from "./backups.json";

const messages = {
  common,
  auth,
  legal,
  nav,
  settings,
  admin,
  search,
  boards,
  errors,
  notifications,
  landing,
  workspaces,
  emails,
  webhooks,
  backups,
};

const languagePack = { language, messages };

export default languagePack;
