import { describe, expect, it } from "vitest";

import { placeOf, reach } from "./place";

const berlin = placeOf({ city: "Berlin", country: "Deutschland" });
const bangalore = placeOf({ city: "Bangalore", country: "India" });
const toronto = placeOf({ city: "Toronto", country: "Canada" });
const nowhere = placeOf({ city: "", country: "" });

describe("where a startup hires, for users anywhere (#222)", () => {
  it("reads the profile's city and country, in any of the usual spellings", () => {
    expect(berlin).toEqual({ city: "Berlin", cityNames: ["berlin"], country: "de", countryName: "Germany" });
    expect(bangalore.cityNames).toEqual(["bengaluru", "bangalore"]);
    expect(nowhere).toEqual({ city: "", cityNames: [], country: "", countryName: "" });
  });

  it("says when a post names the city or the country", () => {
    expect(reach("Acme | Engineer | Berlin, Germany | Onsite", berlin).here).toBe("city");
    expect(reach("Acme | Engineer | Munich, Germany", berlin).here).toBe("country");
    expect(reach("Acme | Engineer | München, Deutschland", berlin).here).toBe("country");
    expect(reach("Acme | Engineer | Bengaluru", bangalore).here).toBe("city");
    expect(reach("Acme | Engineer | Paris, France", berlin)).toEqual({ here: null, remote: false, remoteOpen: null, remoteOnly: "" });
  });

  it("reads whether remote work is open to the profile's country", () => {
    expect(reach("Acme | REMOTE (EU) | Full-time", berlin)).toMatchObject({ remote: true, remoteOpen: true });
    expect(reach("Acme | REMOTE (Europe)", berlin)).toMatchObject({ remote: true, remoteOpen: true });
    expect(reach("Acme | Remote, European time zones", berlin)).toMatchObject({ remote: true, remoteOpen: true });
    expect(reach("Acme | Remote (Europe)", toronto)).toMatchObject({ remoteOpen: false, remoteOnly: "Europe" });
    expect(reach("Acme | Remote (Germany)", berlin)).toMatchObject({ remote: true, remoteOpen: true });
    expect(reach("Acme | Remote, worldwide", bangalore)).toMatchObject({ remote: true, remoteOpen: true });
    expect(reach("Acme | REMOTE (US Timezones) | Full-time", berlin)).toEqual({ here: null, remote: true, remoteOpen: false, remoteOnly: "the US" });
    expect(reach("Acme | Remote US or Ontario, Canada", toronto)).toMatchObject({ remoteOpen: true });
    expect(reach("Acme | Remote US or Ontario, Canada", berlin)).toMatchObject({ remoteOpen: false });
    expect(reach("Acme | Remote (APAC)", bangalore)).toMatchObject({ remoteOpen: true });
    expect(reach("Acme | REMOTE | Full-time", berlin)).toMatchObject({ remote: true, remoteOpen: null });
    expect(reach("San Francisco, CA, USA; Remote", berlin)).toMatchObject({ remote: true, remoteOpen: null });
  });

  it("doesn't take Latin America for the US, or the pronoun for a country", () => {
    expect(reach("Acme | Remote (Latin America)", berlin)).toMatchObject({ remoteOpen: false, remoteOnly: "Latin America" });
    expect(reach("Join us | Remote, from anywhere", berlin)).toMatchObject({ remoteOpen: true });
  });

  it("can't judge remote work's limits without a country", () => {
    expect(reach("Acme | Remote (US only)", nowhere)).toEqual({ here: null, remote: true, remoteOpen: null, remoteOnly: "" });
    expect(reach("Acme | Anywhere in the world", nowhere)).toMatchObject({ remote: true, remoteOpen: true });
  });
});
