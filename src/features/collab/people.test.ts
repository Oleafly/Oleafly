import { describe, expect, it } from "vitest";
import { accountDetail, accountPerson, collabPerson, inPeople, onRoster, peopleById, personDetail } from "./people";
import { account, BOB, CAROL, person, projectMember } from "./tests/fixtures";

describe("how collaborators are labelled", () => {
  it("shows an account's first email, else its first login, else nothing", () => {
    expect(accountDetail(account({ emails: ["a@uni.edu", "b@uni.edu"], logins: ["alice"] }))).toBe("a@uni.edu");
    expect(accountDetail(account({ emails: [], logins: ["alice", "alice2"] }))).toBe("alice");
    expect(accountDetail(account({ emails: [], logins: [] }))).toBe("");
  });

  it("shows a person's email, else their login, else nothing", () => {
    expect(personDetail(person())).toBe("alice@uni.edu");
    expect(personDetail(person({ email: null }))).toBe("alice-chen");
    expect(personDetail(person({ email: null, login: null }))).toBe("");
  });

  it("gives avatars the account id, display name and picture", () => {
    const pictured = account({ avatar_url: "https://img/a.png" });
    expect(accountPerson(pictured)).toEqual({ id: pictured.account_id, name: "Alice Chen", imageUrl: "https://img/a.png" });
    expect(collabPerson(person())).toEqual({ id: person().account_id, name: "Alice Chen", imageUrl: null });
  });

  it("counts members as on the roster, and invited people and people who left as off it", () => {
    expect(onRoster(projectMember())).toBe(true);
    expect(onRoster({ standing: "member" })).toBe(true);
    expect(onRoster({ standing: "invited" })).toBe(false);
    expect(onRoster({ standing: "former" })).toBe(false);
    expect(onRoster({ standing: "unlisted" })).toBe(false);
  });

  it("lists members and invitees under People, and leaves former and unlisted names out", () => {
    expect(inPeople(projectMember())).toBe(true);
    expect(inPeople({ standing: "member" })).toBe(true);
    expect(inPeople({ standing: "invited" })).toBe(true);
    expect(inPeople({ standing: "former" })).toBe(false);
    expect(inPeople({ standing: "unlisted" })).toBe(false);
  });

  it("finds people by id with their standing, keeping a member's own record and the roster entry over another", () => {
    const alice = projectMember(person(), "owner");
    const invited = { ...projectMember(BOB, "viewer"), standing: "invited" as const };
    const left = { ...projectMember(CAROL, "editor"), standing: "former" as const };
    const again = { ...projectMember(person({ display_name: "Alice, earlier" }), "editor"), standing: "former" as const };
    const people = peopleById([alice, invited, left, again]);
    expect(people.get(alice.person.account_id)).toBe(alice.person);
    expect(people.get(BOB.account_id)).toEqual({ ...BOB, standing: "invited" });
    expect(people.get(CAROL.account_id)).toEqual({ ...CAROL, standing: "former" });
    expect(peopleById([left, projectMember(CAROL, "editor")]).get(CAROL.account_id)).toBe(CAROL);
  });
});
