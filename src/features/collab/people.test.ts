import { describe, expect, it } from "vitest";
import { accountDetail, accountPerson, collabPerson, personDetail } from "./people";
import { account, person } from "./tests/fixtures";

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
});
