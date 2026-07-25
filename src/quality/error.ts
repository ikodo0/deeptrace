export class QualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityError";
  }
}
